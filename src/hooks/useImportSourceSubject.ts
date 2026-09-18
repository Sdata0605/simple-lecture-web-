// Reads the app's own course-content tables (popular_subjects ->
// subject_chapters -> subject_topics) so an existing subject can be
// imported into Athena: see ImportSubjectToAthenaDialog.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ImportableCourse {
  id: string;
  name: string;
}

// Courses are the first pick in the import dialog — narrows the (often long)
// subject list down to just what's mapped to the chosen course via
// course_subjects, same join used by CourseSubjectsTab / useCourseSubjects.
export function useImportableCourses() {
  return useQuery({
    queryKey: ["import-source-courses"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ImportableCourse[]> => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });
}

export interface ImportableSubject {
  id: string;
  name: string;
  category_id: string;
  categories: { id: string; name: string } | null;
}

// Same source list (active subjects, joined to their category) used
// elsewhere in admin — see useAllSubjects.ts.
export function useImportableSubjects() {
  return useQuery({
    queryKey: ["import-source-subjects"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ImportableSubject[]> => {
      const { data, error } = await supabase
        .from("popular_subjects")
        .select("id, name, category_id, categories(id, name)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });
}

// Subjects mapped to one course (course_subjects join), for the "narrow by
// course first" step in the import dialog.
export function useImportableSubjectsForCourse(courseId?: string) {
  return useQuery({
    queryKey: ["import-source-subjects-for-course", courseId],
    enabled: !!courseId,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ImportableSubject[]> => {
      const { data, error } = await supabase
        .from("course_subjects")
        .select("display_order, subject:popular_subjects(id, name, category_id, categories(id, name), is_active)")
        .eq("course_id", courseId!)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return ((data as any) || [])
        .map((row: any) => row.subject)
        .filter((s: any) => s && s.is_active !== false);
    },
  });
}

export interface SourceSubjectMeta {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export function useSourceSubjectMeta(subjectId?: string) {
  return useQuery({
    queryKey: ["import-source-subject-meta", subjectId],
    enabled: !!subjectId,
    queryFn: async (): Promise<SourceSubjectMeta> => {
      const { data, error } = await supabase
        .from("popular_subjects")
        .select("id, name, slug, description")
        .eq("id", subjectId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export interface SourceTopic {
  id: string;
  chapter_id: string;
  topic_number: string;
  title: string;
  content_markdown: string | null;
  notes_markdown: string | null;
  // Resolved full markdown to submit as this topic's document — see
  // resolveTopicMarkdown below for where this actually comes from.
  markdown: string;
}

export interface SourceChapter {
  id: string;
  chapter_number: number;
  title: string;
  notes_markdown: string | null;
}

export interface SourceSubjectContent {
  chapters: SourceChapter[];
  topicsByChapter: Record<string, SourceTopic[]>;
}

function naturalCompare(a: string, b: string) {
  return String(a || "").localeCompare(String(b || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// The full extracted text of a processed document lives in
// ai_assistant_documents.full_content (jsonb) — same shape/precedence as
// extractContentMarkdown() in SubjectNotesTab.tsx. subject_topics.content_markdown /
// notes_markdown are only short stubs, not the full text, so they're the
// fallback here, not the primary source.
function extractMarkdownFromDocument(fullContent: unknown): string {
  if (fullContent && typeof fullContent === "object" && !Array.isArray(fullContent)) {
    const obj = fullContent as Record<string, unknown>;
    const candidate = obj.content_markdown ?? obj.markdown ?? obj.content ?? obj.text;
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  if (typeof fullContent === "string" && fullContent.trim()) return fullContent;
  return "";
}

// Full chapter+topic tree (with resolved markdown) for one subject, fetched
// in three queries (not N+1 per chapter/topic) so the import dialog can build
// its checklist up front before doing any writes.
export function useSourceSubjectContent(subjectId?: string) {
  return useQuery({
    queryKey: ["import-source-subject-content", subjectId],
    enabled: !!subjectId,
    queryFn: async (): Promise<SourceSubjectContent> => {
      const { data: chapters, error: chaptersError } = await supabase
        .from("subject_chapters")
        .select("id, chapter_number, title, notes_markdown")
        .eq("subject_id", subjectId!)
        .order("chapter_number", { ascending: true });
      if (chaptersError) throw chaptersError;

      const chapterIds = (chapters ?? []).map((c) => c.id);
      let rawTopics: Array<Omit<SourceTopic, "markdown">> = [];
      if (chapterIds.length > 0) {
        const { data, error: topicsError } = await supabase
          .from("subject_topics")
          .select("id, chapter_id, topic_number, title, content_markdown, notes_markdown")
          .in("chapter_id", chapterIds);
        if (topicsError) throw topicsError;
        rawTopics = data ?? [];
      }

      // Latest processed document per topic — same table/precedence the
      // Notes tab reads from, ordered newest-first so the first row we see
      // per topic_id is the one to use.
      const topicIds = rawTopics.map((t) => t.id);
      const fullContentByTopic = new Map<string, unknown>();
      if (topicIds.length > 0) {
        const { data: docs, error: docsError } = await supabase
          .from("ai_assistant_documents")
          .select("topic_id, full_content, created_at")
          .in("topic_id", topicIds)
          .order("created_at", { ascending: false });
        if (docsError) throw docsError;
        for (const doc of docs ?? []) {
          if (doc.topic_id && !fullContentByTopic.has(doc.topic_id)) {
            fullContentByTopic.set(doc.topic_id, doc.full_content);
          }
        }
      }

      const topics: SourceTopic[] = rawTopics.map((t) => {
        const fromDocument = extractMarkdownFromDocument(fullContentByTopic.get(t.id));
        const markdown = fromDocument || t.content_markdown?.trim() || t.notes_markdown?.trim() || "";
        return { ...t, markdown };
      });

      const topicsByChapter: Record<string, SourceTopic[]> = {};
      for (const t of topics) {
        (topicsByChapter[t.chapter_id] ??= []).push(t);
      }
      for (const key of Object.keys(topicsByChapter)) {
        topicsByChapter[key].sort((a, b) => naturalCompare(a.topic_number, b.topic_number));
      }

      return { chapters: chapters ?? [], topicsByChapter };
    },
  });
}
