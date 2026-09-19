import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderInput,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { saveDocumentMarkdown } from "@/lib/athenaDocumentMarkdownStore";
import { sanitizeTitleForFilename } from "@/lib/athenaTitleMatch";
import {
  AthenaChapter,
  AthenaSubject,
  AthenaTopic,
  athenaGet,
  athenaPostJson,
  athenaUpload,
  useAthenaSubjects,
} from "@/hooks/useAthenaApi";
import {
  useImportableCourses,
  useImportableSubjectsForCourse,
  useSourceSubjectContent,
  useSourceSubjectMeta,
} from "@/hooks/useImportSourceSubject";

type ItemStatus = "pending" | "working" | "uploading" | "done" | "reused" | "no-content" | "failed";

interface ItemState {
  status: ItemStatus;
  message?: string;
}

const PENDING: ItemState = { status: "pending" };

function StatusIcon({ status }: { status: ItemStatus }) {
  switch (status) {
    case "pending":
      return <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 inline-block" />;
    case "working":
    case "uploading":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case "done":
    case "reused":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    case "no-content":
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  }
}

function statusLabel(status: ItemStatus) {
  switch (status) {
    case "pending": return "Pending";
    case "working": return "Creating…";
    case "uploading": return "Submitting markdown…";
    case "done": return "Done";
    case "reused": return "Already existed";
    case "no-content": return "Created (no markdown)";
    case "failed": return "Failed";
  }
}

function sanitizeFilename(title: string) {
  // Shared with the Documents-tab title matcher — see athenaTitleMatch.ts for why.
  const cleaned = sanitizeTitleForFilename(title).slice(0, 80);
  return `${cleaned || "topic"}.md`;
}

export function ImportSubjectToAthenaDialog({ onImported }: { onImported: (athenaSubjectId: string) => void }) {
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"select" | "configure" | "running">("select");
  const [courseId, setCourseId] = useState<string>("");
  const [sourceSubjectId, setSourceSubjectId] = useState<string>("");

  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [targetExistingId, setTargetExistingId] = useState<string>("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  const [chapterStatus, setChapterStatus] = useState<Record<string, ItemState>>({});
  const [topicStatus, setTopicStatus] = useState<Record<string, ItemState>>({});
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const cancelledRef = useRef(false);

  const sourceCourses = useImportableCourses();
  const sourceSubjects = useImportableSubjectsForCourse(courseId || undefined);
  const athenaSubjects = useAthenaSubjects();
  const sourceMeta = useSourceSubjectMeta(sourceSubjectId || undefined);
  const sourceContent = useSourceSubjectContent(sourceSubjectId || undefined);

  // Prefill the new-subject fields from the source subject once its meta loads
  // (only while the user hasn't started typing something else in).
  useEffect(() => {
    if (!sourceMeta.data) return;
    setName((prev) => prev || sourceMeta.data!.name);
    setSlug((prev) => prev || sourceMeta.data!.slug || "");
    setDescription((prev) => prev || sourceMeta.data!.description || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMeta.data]);

  const resetAll = () => {
    setStep("select");
    setCourseId("");
    setSourceSubjectId("");
    setTargetMode("new");
    setTargetExistingId("");
    setName("");
    setSlug("");
    setDescription("");
    setChapterStatus({});
    setTopicStatus({});
    setExpandedChapters({});
    setRunning(false);
    setFinished(false);
    cancelledRef.current = false;
  };

  const handleOpenChange = (v: boolean) => {
    if (!v && running) return; // don't let the dialog close mid-run
    setOpen(v);
    if (!v) resetAll();
  };

  const handleCourseChange = (v: string) => {
    setCourseId(v);
    setSourceSubjectId(""); // stale pick from the previous course would be wrong
  };

  const goToConfigure = () => {
    if (!courseId) {
      toast({ title: "Pick a course first", variant: "destructive" });
      return;
    }
    if (!sourceSubjectId) {
      toast({ title: "Pick a subject to import", variant: "destructive" });
      return;
    }
    setStep("configure");
  };

  const totalTopics = Object.keys(topicStatus).length;
  const doneTopics = Object.values(topicStatus).filter((s) =>
    ["done", "reused", "no-content"].includes(s.status),
  ).length;
  const failedTopics = Object.values(topicStatus).filter((s) => s.status === "failed").length;

  const startImport = async () => {
    if (targetMode === "new" && !name.trim()) {
      toast({ title: "Subject name is required", variant: "destructive" });
      return;
    }
    if (targetMode === "existing" && !targetExistingId) {
      toast({ title: "Pick an existing Athena subject", variant: "destructive" });
      return;
    }
    const content = sourceContent.data;
    if (!content) {
      toast({ title: "Still loading subject content, try again in a moment", variant: "destructive" });
      return;
    }

    const initialChapterStatus: Record<string, ItemState> = {};
    const initialTopicStatus: Record<string, ItemState> = {};
    const initialExpanded: Record<string, boolean> = {};
    for (const c of content.chapters) {
      initialChapterStatus[c.id] = PENDING;
      initialExpanded[c.id] = true;
      for (const t of content.topicsByChapter[c.id] ?? []) {
        initialTopicStatus[t.id] = PENDING;
      }
    }
    setChapterStatus(initialChapterStatus);
    setTopicStatus(initialTopicStatus);
    setExpandedChapters(initialExpanded);
    cancelledRef.current = false;
    setFinished(false);
    setRunning(true);
    setStep("running");

    try {
      // 1. Resolve the target Athena subject (create, or reuse the picked one).
      let athenaSubjectId = targetExistingId;
      if (targetMode === "new") {
        const created = await athenaPostJson<AthenaSubject>("/subjects", {
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || undefined,
        });
        athenaSubjectId = created.id;
      }

      // Record the link so the student-facing "ask a question" feature knows
      // which Athena subject this app subject's /ask calls should scope to —
      // there's no other way to derive this (Athena's IDs are a separate
      // system with no prior stored connection back to this app).
      await supabase
        .from("popular_subjects")
        .update({ athena_subject_id: athenaSubjectId })
        .eq("id", sourceSubjectId)
        .then(({ error }) => {
          if (error) console.warn("[ImportSubjectToAthenaDialog] Failed to save athena_subject_id link:", error);
        });

      // 2. Chapters already on the target subject — dedupe re-imports by title.
      const existingChapters = await athenaGet<{ chapters: AthenaChapter[] }>(
        `/subjects/${athenaSubjectId}/chapters`,
      ).then((d) => d.chapters ?? []).catch(() => [] as AthenaChapter[]);
      const chapterByTitle = new Map<string, string>(
        existingChapters.map((c) => [c.title.trim().toLowerCase(), c.id]),
      );

      for (const chapter of content.chapters) {
        if (cancelledRef.current) break;
        setChapterStatus((prev) => ({ ...prev, [chapter.id]: { status: "working" } }));

        let athenaChapterId: string;
        try {
          const key = chapter.title.trim().toLowerCase();
          if (chapterByTitle.has(key)) {
            athenaChapterId = chapterByTitle.get(key)!;
            setChapterStatus((prev) => ({ ...prev, [chapter.id]: { status: "reused" } }));
          } else {
            const created = await athenaPostJson<AthenaChapter>("/chapters", {
              subjectId: athenaSubjectId,
              title: chapter.title,
              chapterNumber: chapter.chapter_number,
            });
            athenaChapterId = created.id;
            chapterByTitle.set(key, athenaChapterId);
            setChapterStatus((prev) => ({ ...prev, [chapter.id]: { status: "done" } }));
          }
        } catch (err) {
          const message = (err as Error).message;
          setChapterStatus((prev) => ({ ...prev, [chapter.id]: { status: "failed", message } }));
          for (const t of content.topicsByChapter[chapter.id] ?? []) {
            setTopicStatus((prev) => ({ ...prev, [t.id]: { status: "failed", message: "Chapter failed to create" } }));
          }
          continue;
        }

        const existingTopics = await athenaGet<{ topics: AthenaTopic[] }>(
          `/chapters/${athenaChapterId}/topics`,
        ).then((d) => d.topics ?? []).catch(() => [] as AthenaTopic[]);
        const topicByTitle = new Map<string, string>(
          existingTopics.map((t) => [t.title.trim().toLowerCase(), t.id]),
        );

        for (const topic of content.topicsByChapter[chapter.id] ?? []) {
          if (cancelledRef.current) break;
          setTopicStatus((prev) => ({ ...prev, [topic.id]: { status: "working" } }));

          let athenaTopicId: string;
          let topicReused = false;
          try {
            const key = topic.title.trim().toLowerCase();
            if (topicByTitle.has(key)) {
              athenaTopicId = topicByTitle.get(key)!;
              topicReused = true;
            } else {
              const created = await athenaPostJson<AthenaTopic>("/topics", {
                chapterId: athenaChapterId,
                title: topic.title,
                // Upstream 500s if this is a JSON number — must be a string
                // (source data is already a string, subject_topics.topic_number).
                topicNumber: topic.topic_number || undefined,
              });
              athenaTopicId = created.id;
              topicByTitle.set(key, athenaTopicId);
            }
          } catch (err) {
            setTopicStatus((prev) => ({ ...prev, [topic.id]: { status: "failed", message: (err as Error).message } }));
            continue;
          }

          void supabase
            .from("subject_topics")
            .update({ athena_topic_id: athenaTopicId })
            .eq("id", topic.id)
            .then(({ error }) => {
              if (error) console.warn("[ImportSubjectToAthenaDialog] Failed to save athena_topic_id link:", error);
            });

          const markdown = topic.markdown;
          if (!markdown) {
            setTopicStatus((prev) => ({ ...prev, [topic.id]: { status: topicReused ? "reused" : "no-content" } }));
            continue;
          }

          setTopicStatus((prev) => ({ ...prev, [topic.id]: { status: "uploading" } }));
          try {
            const file = new File([markdown], sanitizeFilename(topic.title), { type: "text/markdown" });
            const fd = new FormData();
            fd.append("files", file);
            fd.append("subjectId", athenaSubjectId);
            fd.append("chapterId", athenaChapterId);
            fd.append("topicId", athenaTopicId);
            const res = await athenaUpload<{ uploaded?: Array<{ document_id: string }> }>("/documents", fd);
            const documentId = res.uploaded?.[0]?.document_id;
            if (documentId) saveDocumentMarkdown(athenaSubjectId, documentId, markdown);
            setTopicStatus((prev) => ({ ...prev, [topic.id]: { status: "done" } }));
          } catch (err) {
            setTopicStatus((prev) => ({ ...prev, [topic.id]: { status: "failed", message: (err as Error).message } }));
          }
        }
      }

      qc.invalidateQueries({ queryKey: ["athena"] });
      setFinished(true);
      setRunning(false);
      onImported(athenaSubjectId);
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
      setFinished(true);
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <FolderInput className="h-4 w-4" /> Import Subject
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a Subject into Athena</DialogTitle>
          <DialogDescription>
            Pulls an existing subject's chapters, topics and topic markdown from the app and creates the
            matching structure on Athena, submitting each topic's markdown as a document automatically.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Course</Label>
              <Select value={courseId} onValueChange={handleCourseChange}>
                <SelectTrigger>
                  <SelectValue placeholder={sourceCourses.isLoading ? "Loading courses…" : "Select a course"} />
                </SelectTrigger>
                <SelectContent>
                  {(sourceCourses.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject to import</Label>
              <Select value={sourceSubjectId} onValueChange={setSourceSubjectId} disabled={!courseId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !courseId
                        ? "Pick a course first"
                        : sourceSubjects.isLoading
                        ? "Loading subjects…"
                        : (sourceSubjects.data ?? []).length === 0
                        ? "No subjects mapped to this course"
                        : "Select a subject"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(sourceSubjects.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{s.categories?.name ? ` — ${s.categories.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sourceSubjectId && (
              <div className="text-sm text-muted-foreground">
                {sourceContent.isLoading ? (
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chapters &amp; topics…</span>
                ) : sourceContent.data ? (
                  <span>
                    {sourceContent.data.chapters.length} chapter(s),{" "}
                    {Object.values(sourceContent.data.topicsByChapter).reduce((n, arr) => n + arr.length, 0)} topic(s) found.
                  </span>
                ) : null}
              </div>
            )}
            <DialogFooter>
              <Button onClick={goToConfigure} disabled={!courseId || !sourceSubjectId || sourceContent.isLoading}>
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "configure" && (
          <div className="space-y-4">
            <RadioGroup value={targetMode} onValueChange={(v: "new" | "existing") => setTargetMode(v)}>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="new" id="target-new" className="mt-1" />
                <Label htmlFor="target-new" className="font-normal cursor-pointer">
                  Create a new Athena subject
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="existing" id="target-existing" className="mt-1" />
                <Label htmlFor="target-existing" className="font-normal cursor-pointer">
                  Add into an existing Athena subject (safe re-run — matching chapters/topics are reused, not duplicated)
                </Label>
              </div>
            </RadioGroup>

            {targetMode === "new" ? (
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug (optional)</Label>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Description (optional)</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 pl-6">
                <Label>Athena subject</Label>
                <Select value={targetExistingId} onValueChange={setTargetExistingId}>
                  <SelectTrigger>
                    <SelectValue placeholder={athenaSubjects.isLoading ? "Loading…" : "Select an Athena subject"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(athenaSubjects.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("select")}>Back</Button>
              <Button onClick={startImport}>Start Import</Button>
            </DialogFooter>
          </div>
        )}

        {step === "running" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {finished ? "Import finished" : "Importing…"} — {doneTopics}/{totalTopics} topic(s) processed
                {failedTopics > 0 && <span className="text-destructive"> · {failedTopics} failed</span>}
              </span>
              {!finished && (
                <Button variant="outline" size="sm" onClick={() => { cancelledRef.current = true; }}>
                  Stop after current item
                </Button>
              )}
            </div>

            <ScrollArea className="h-[360px] rounded-md border p-2">
              <div className="space-y-1">
                {(sourceContent.data?.chapters ?? []).map((chapter) => {
                  const cState = chapterStatus[chapter.id] ?? PENDING;
                  const isOpen = expandedChapters[chapter.id] ?? true;
                  const topics = sourceContent.data?.topicsByChapter[chapter.id] ?? [];
                  return (
                    <div key={chapter.id} className="rounded-md">
                      <button
                        onClick={() => setExpandedChapters((prev) => ({ ...prev, [chapter.id]: !isOpen }))}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-left"
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium flex-1 truncate">{chapter.title}</span>
                        <span className="text-xs text-muted-foreground">{statusLabel(cState.status)}</span>
                        <StatusIcon status={cState.status} />
                      </button>
                      {cState.status === "failed" && cState.message && (
                        <div className="ml-9 text-xs text-destructive pb-1">{cState.message}</div>
                      )}
                      {isOpen && topics.length > 0 && (
                        <div className="ml-6 space-y-0.5 border-l pl-3 pb-1">
                          {topics.map((topic) => {
                            const tState = topicStatus[topic.id] ?? PENDING;
                            return (
                              <div key={topic.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="flex-1 truncate">{topic.title}</span>
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  {statusLabel(tState.status)}
                                </Badge>
                                <StatusIcon status={tState.status} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <DialogFooter>
              {finished ? (
                <Button onClick={() => handleOpenChange(false)}>Close</Button>
              ) : (
                <Button variant="outline" disabled>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
