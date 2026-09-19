// For subjects imported into Athena before athena_subject_id/athena_topic_id
// existed (or imported by hand outside ImportSubjectToAthenaDialog) — lets an
// admin retroactively point an app subject at the Athena subject it matches,
// and auto-links its topics by title (same normalizer the Documents-tab
// markdown matcher uses, so results are consistent across both features).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { athenaGet, AthenaChapter, AthenaTopic } from "@/hooks/useAthenaApi";
import { useImportableSubjects, useSourceSubjectContent } from "@/hooks/useImportSourceSubject";
import { normalizeTitleForMatch } from "@/lib/athenaTitleMatch";

export function LinkAthenaSubjectDialog({
  athenaSubjectId,
  athenaSubjectName,
}: {
  athenaSubjectId: string;
  athenaSubjectName?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [appSubjectId, setAppSubjectId] = useState("");
  const [linking, setLinking] = useState(false);
  const [result, setResult] = useState<{ topicsMatched: number; topicsTotal: number } | null>(null);

  const appSubjects = useImportableSubjects();
  const sourceContent = useSourceSubjectContent(appSubjectId || undefined);

  const runLink = async () => {
    if (!appSubjectId) {
      toast({ title: "Pick an app subject first", variant: "destructive" });
      return;
    }
    const content = sourceContent.data;
    if (!content) {
      toast({ title: "Still loading that subject's chapters/topics, try again", variant: "destructive" });
      return;
    }
    setLinking(true);
    setResult(null);
    try {
      const { error: subjErr } = await supabase
        .from("popular_subjects")
        .update({ athena_subject_id: athenaSubjectId })
        .eq("id", appSubjectId);
      if (subjErr) throw subjErr;

      const athenaChapters = await athenaGet<{ chapters: AthenaChapter[] }>(
        `/subjects/${athenaSubjectId}/chapters`,
      ).then((d) => d.chapters ?? []);
      const chapterByTitle = new Map(athenaChapters.map((c) => [normalizeTitleForMatch(c.title), c.id]));

      let matched = 0;
      let total = 0;
      for (const chapter of content.chapters) {
        const athenaChapterId = chapterByTitle.get(normalizeTitleForMatch(chapter.title));
        const topics = content.topicsByChapter[chapter.id] ?? [];
        total += topics.length;
        if (!athenaChapterId) continue;

        const athenaTopics = await athenaGet<{ topics: AthenaTopic[] }>(
          `/chapters/${athenaChapterId}/topics`,
        ).then((d) => d.topics ?? []).catch(() => [] as AthenaTopic[]);
        const topicByTitle = new Map(athenaTopics.map((t) => [normalizeTitleForMatch(t.title), t.id]));

        for (const topic of topics) {
          const athenaTopicId = topicByTitle.get(normalizeTitleForMatch(topic.title));
          if (!athenaTopicId) continue;
          const { error } = await supabase
            .from("subject_topics")
            .update({ athena_topic_id: athenaTopicId })
            .eq("id", topic.id);
          if (!error) matched++;
        }
      }

      setResult({ topicsMatched: matched, topicsTotal: total });
      qc.invalidateQueries({ queryKey: ["import-source-subjects"] });
      toast({ title: "Linked", description: `${matched}/${total} topics matched by title.` });
    } catch (err) {
      toast({ title: "Linking failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setAppSubjectId(""); setResult(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Link2 className="h-3.5 w-3.5" /> Link app subject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link "{athenaSubjectName || athenaSubjectId}" to an app subject</DialogTitle>
          <DialogDescription>
            Records which app subject this Athena subject corresponds to (needed for the student "ask a
            question" feature), and matches its topics by title.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>App subject</Label>
            <Select value={appSubjectId} onValueChange={setAppSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder={appSubjects.isLoading ? "Loading…" : "Select a subject"} />
              </SelectTrigger>
              <SelectContent>
                {(appSubjects.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.categories?.name ? ` — ${s.categories.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {result && (
            <div className="rounded-md border bg-muted/30 p-2 text-sm">
              {result.topicsMatched}/{result.topicsTotal} topics matched by title.
              {result.topicsMatched < result.topicsTotal && (
                <span className="text-muted-foreground">
                  {" "}Unmatched ones likely have a different title on Athena — re-run Import Subject to fix.
                </span>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={runLink} disabled={!appSubjectId || linking || sourceContent.isLoading}>
            {linking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
