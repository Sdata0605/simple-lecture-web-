import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Languages, Loader2, Mic, Settings2, CheckCircle2, XCircle, PlayCircle, ChevronDown, ListChecks, ListTree, Rocket, Square, RotateCcw, Trash2, ChevronRight } from "lucide-react";
import { useVideoGenerationJobs, type VideoJobWithDocument } from "@/hooks/useVideoGenerationJobs";
import { useSubjectChapters, useChapterTopics } from "@/hooks/useSubjectChaptersTopics";
import { SUPPORTED_VOICES, DEFAULT_SPEAKER } from "@/hooks/useLanguageAvatarJobs";
import { useDubbingJobs, useDubbingJobMutations, type DubbedLanguageEntry, type DubbingJob } from "@/hooks/useDubbingJobs";
import { useDubbingBatchRun, type DubbingBatchItem } from "@/hooks/useDubbingBatchRun";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

// Short ISO-639-1 style codes the dub_languages endpoint expects — a
// different convention from the full-name codes used by the (separate)
// language-avatar feature, so this list is intentionally its own thing.
const DUB_LANGUAGES = [
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "kn", name: "Kannada", flag: "🇮🇳" },
  { code: "mr", name: "Marathi", flag: "🇮🇳" },
  { code: "ta", name: "Tamil", flag: "🇮🇳" },
  { code: "te", name: "Telugu", flag: "🇮🇳" },
  { code: "ml", name: "Malayalam", flag: "🇮🇳" },
  { code: "bn", name: "Bengali", flag: "🇮🇳" },
  { code: "gu", name: "Gujarati", flag: "🇮🇳" },
  { code: "pa", name: "Punjabi", flag: "🇮🇳" },
  { code: "or", name: "Odia", flag: "🇮🇳" },
  { code: "as", name: "Assamese", flag: "🇮🇳" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
] as const;

const TTS_ENGINES = [
  { value: "edgetts", label: "Edge TTS (default)" },
  { value: "sarvam", label: "Sarvam" },
  { value: "indicf5", label: "IndicF5" },
] as const;

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "processing") return "secondary";
  return "outline";
}

function statusIcon(status: string) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5" />;
  if (status === "processing") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return null;
}

interface DubbingPipelineProps {
  subjectId: string;
  subjectName: string;
  defaultServerIp: string;
}

type DubState = "idle" | "processing" | "completed" | "failed";

export function DubbingPipeline({ subjectId, subjectName, defaultServerIp }: DubbingPipelineProps) {
  const [innerTab, setInnerTab] = useState<"new" | "pipeline" | "status">("new");

  return (
    <div className="space-y-4">
      <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as "new" | "pipeline" | "status")}>
        <TabsList className="h-8">
          <TabsTrigger value="new" className="text-xs gap-1 px-3">
            <ListTree className="h-3.5 w-3.5" />
            New Dub
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="text-xs gap-1 px-3">
            <Rocket className="h-3.5 w-3.5" />
            Auto Pipeline
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs gap-1 px-3">
            <ListChecks className="h-3.5 w-3.5" />
            Status
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {innerTab === "new" && (
        <NewDubbingForm subjectId={subjectId} defaultServerIp={defaultServerIp} />
      )}
      {innerTab === "pipeline" && (
        <DubbingBatchPipeline subjectId={subjectId} subjectName={subjectName} defaultServerIp={defaultServerIp} />
      )}
      {innerTab === "status" && (
        <DubbingStatusList subjectId={subjectId} defaultServerIp={defaultServerIp} />
      )}
    </div>
  );
}

function NewDubbingForm({ subjectId, defaultServerIp }: { subjectId: string; defaultServerIp: string }) {
  // Chapter -> Topic selection (required, cascading) — matches the filter
  // pattern already used by the Manual tab's own chapter/topic pickers.
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const { data: chapters } = useSubjectChapters(subjectId);
  const { data: topics } = useChapterTopics(selectedChapterId || undefined);

  useEffect(() => {
    setSelectedTopicId(null);
  }, [selectedChapterId]);

  // Only published, completed jobs for the chosen topic are dub-able.
  const { data: allJobs, isLoading: jobsLoading } = useVideoGenerationJobs({ subjectId, status: "completed" });
  const jobsForTopic = useMemo(() => {
    if (!selectedTopicId || !allJobs) return [];
    return allJobs.filter(
      (j) => j.is_published === true && j.ai_assistant_documents?.topic_id === selectedTopicId
    );
  }, [allJobs, selectedTopicId]);

  const [selectedJobId, setSelectedJobId] = useState<string>("");
  useEffect(() => {
    setSelectedJobId("");
  }, [selectedTopicId]);

  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [speaker, setSpeaker] = useState(DEFAULT_SPEAKER);
  const [ttsEngine, setTtsEngine] = useState<string>("edgetts");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [avatarId, setAvatarId] = useState("");
  const [skipAvatar, setSkipAvatar] = useState(false);
  const [skipSectionMerge, setSkipSectionMerge] = useState(false);
  const [skipFinalMerge, setSkipFinalMerge] = useState(false);

  const [isTriggering, setIsTriggering] = useState(false);
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);
  const [dubState, setDubState] = useState<DubState>("idle");
  const [dubProgressMessage, setDubProgressMessage] = useState("");
  const [dubError, setDubError] = useState<string | null>(null);
  const [dubbedLanguages, setDubbedLanguages] = useState<DubbedLanguageEntry[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dbRowIdRef = useRef<string | null>(null);

  const { createDubbingJob, updateDubbingJob } = useDubbingJobMutations();

  const selectedJob: VideoJobWithDocument | undefined = jobsForTopic.find((j) => j.id === selectedJobId);

  const resetForNewJob = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    dbRowIdRef.current = null;
    setSelectedLanguages([]);
    setDubState("idle");
    setDubProgressMessage("");
    setDubError(null);
    setDubbedLanguages([]);
  };

  const fetchDubbedLanguages = useCallback(async (job: VideoJobWithDocument) => {
    if (!job.external_job_id) return [] as DubbedLanguageEntry[];
    const { data, error } = await supabase.functions.invoke("video-generation-proxy", {
      body: { action: "review", job_id: job.external_job_id, server_ip: job.server_ip || defaultServerIp },
    });
    if (error || !data) return [] as DubbedLanguageEntry[];
    const list = (data as Record<string, unknown>).dubbed_languages;
    const entries = Array.isArray(list) ? (list as DubbedLanguageEntry[]) : [];
    setDubbedLanguages(entries);
    return entries;
  }, [defaultServerIp]);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const startPolling = useCallback((job: VideoJobWithDocument) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      if (!job.external_job_id) return;
      try {
        const { data, error } = await supabase.functions.invoke("video-generation-proxy", {
          body: { action: "dub_status", job_id: job.external_job_id, server_ip: job.server_ip || defaultServerIp },
        });
        if (error || !data) return;

        const details = (data as Record<string, unknown>).details as Record<string, unknown> | undefined;
        const status = (data as Record<string, unknown>).status as string | undefined;
        const progressMsg = (details?.progress as string) || "";
        setDubProgressMessage(progressMsg);
        if (dbRowIdRef.current) {
          updateDubbingJob(dbRowIdRef.current, { progress_message: progressMsg }, subjectId).catch(() => {});
        }

        if (status === "completed") {
          stopPolling();
          setDubState("completed");
          toast.success("Dubbing completed");
          const entries = await fetchDubbedLanguages(job);
          if (dbRowIdRef.current) {
            await updateDubbingJob(dbRowIdRef.current, { status: "completed", dubbed_languages: entries }, subjectId);
          }
        } else if (status === "failed") {
          stopPolling();
          setDubState("failed");
          const errMsg = (details?.error as string) || "Dubbing failed";
          setDubError(errMsg);
          toast.error("Dubbing failed");
          if (dbRowIdRef.current) {
            await updateDubbingJob(dbRowIdRef.current, { status: "failed", error_message: errMsg }, subjectId);
          }
        } else {
          setDubState("processing");
        }
      } catch (err) {
        console.error("Dub status poll error:", err);
      }
    }, 3000);
  }, [defaultServerIp, fetchDubbedLanguages, subjectId, updateDubbingJob]);

  // When a job is picked, check whether a dub is already running/complete
  // for it — the backend refuses a second concurrent dub for the same
  // job_id, so surfacing existing state up front avoids a confusing
  // "nothing happened" click.
  useEffect(() => {
    resetForNewJob();
    if (!selectedJob?.external_job_id) return;

    (async () => {
      setIsCheckingExisting(true);
      try {
        const { data } = await supabase.functions.invoke("video-generation-proxy", {
          body: {
            action: "dub_status",
            job_id: selectedJob.external_job_id,
            server_ip: selectedJob.server_ip || defaultServerIp,
          },
        });
        const status = (data as Record<string, unknown> | null)?.status as string | undefined;
        if (status === "processing") {
          setDubState("processing");
          startPolling(selectedJob);
        } else if (status === "completed") {
          setDubState("completed");
          await fetchDubbedLanguages(selectedJob);
        }
      } catch {
        // No existing dub run for this job — fine, admin starts a fresh one.
      } finally {
        setIsCheckingExisting(false);
      }
    })();

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId]);

  useEffect(() => () => stopPolling(), []);

  const toggleLanguage = (code: string) => {
    setSelectedLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleStartDubbing = async () => {
    if (!selectedJob?.external_job_id) return;
    if (selectedLanguages.length === 0) {
      toast.error("Pick at least one language");
      return;
    }

    setIsTriggering(true);
    try {
      const { data, error } = await supabase.functions.invoke("video-generation-proxy", {
        body: {
          action: "dub_languages",
          job_id: selectedJob.external_job_id,
          server_ip: selectedJob.server_ip || defaultServerIp,
          languages: selectedLanguages,
          speaker,
          tts_engine: ttsEngine,
          ...(avatarId.trim() ? { avatar_id: avatarId.trim() } : {}),
          skip_avatar: skipAvatar,
          skip_section_merge: skipSectionMerge,
          skip_final_merge: skipFinalMerge,
        },
      });

      if (error) {
        toast.error("Couldn't start dubbing", { description: error.message });
        return;
      }

      const status = (data as Record<string, unknown> | null)?.status as string | undefined;
      if (status && status !== "queued") {
        toast.error("Couldn't start dubbing", {
          description: (data as Record<string, unknown>).message as string | undefined,
        });
        return;
      }

      toast.success((data as Record<string, unknown>)?.message as string || "Dubbing started");
      setDubState("processing");
      setDubError(null);

      try {
        const row = await createDubbingJob({
          video_job_id: selectedJob.id,
          external_job_id: selectedJob.external_job_id,
          subject_id: subjectId,
          document_name: selectedJob.document_name,
          languages: selectedLanguages,
          speaker,
          tts_engine: ttsEngine,
          server_ip: selectedJob.server_ip || defaultServerIp,
        });
        dbRowIdRef.current = row.id;
      } catch (err) {
        console.error("Couldn't record dubbing job row:", err);
      }

      startPolling(selectedJob);
    } catch (err) {
      console.error("Trigger dubbing error:", err);
      toast.error("Couldn't start dubbing");
    } finally {
      setIsTriggering(false);
    }
  };

  const videoUrlFor = (entry: DubbedLanguageEntry) => {
    const ip = selectedJob?.server_ip || defaultServerIp;
    return `http://${ip}:5006/player/jobs/${selectedJob?.external_job_id}/${entry.video_path}`;
  };

  const languageName = (code: string) => DUB_LANGUAGES.find((l) => l.code === code)?.name || code;

  const isDubRunning = dubState === "processing";

  return (
    <div className="space-y-4">
      <Card className="bg-muted/20">
        <CardContent className="pt-6 space-y-4">
          <div>
            <Label className="text-sm font-medium flex items-center gap-2 mb-2">
              <Languages className="h-4 w-4 text-muted-foreground" />
              1. Select a chapter and topic
            </Label>
            <div className="flex flex-wrap gap-3">
              <Select
                value={selectedChapterId || ""}
                onValueChange={(val) => setSelectedChapterId(val || null)}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Select a chapter" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {chapters?.map((chapter) => (
                    <SelectItem key={chapter.id} value={chapter.id}>
                      Ch {chapter.chapter_number}: {chapter.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedTopicId || ""}
                onValueChange={(val) => setSelectedTopicId(val || null)}
                disabled={!selectedChapterId}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder={selectedChapterId ? "Select a topic" : "Pick a chapter first"} />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {topics?.map((topic) => (
                    <SelectItem key={topic.id} value={topic.id}>
                      Topic {topic.topic_number}: {topic.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedTopicId && (
            <div>
              <Label className="text-sm font-medium flex items-center gap-2 mb-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                2. Pick a published video to dub
              </Label>
              {jobsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading videos...
                </div>
              ) : jobsForTopic.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No published videos found for this topic yet. Publish a video in the Manual tab first.
                </p>
              ) : (
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger className="w-full max-w-xl">
                    <SelectValue placeholder="Select a published video" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobsForTopic.map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.document_name || "Untitled document"}
                        {job.created_at ? ` — generated ${format(new Date(job.created_at), "PPp")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {isCheckingExisting && selectedJob && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking for an existing dub run...
            </div>
          )}

          {selectedJob && !isCheckingExisting && (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  3. Target languages
                </Label>
                <div className="flex flex-wrap gap-2">
                  {DUB_LANGUAGES.map((lang) => (
                    <Badge
                      key={lang.code}
                      variant={selectedLanguages.includes(lang.code) ? "default" : "outline"}
                      className="cursor-pointer hover:bg-primary/80 transition-colors"
                      onClick={() => !isDubRunning && toggleLanguage(lang.code)}
                    >
                      {lang.flag} {lang.name}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                    Speaker
                  </Label>
                  <Select value={speaker} onValueChange={setSpeaker} disabled={isDubRunning}>
                    <SelectTrigger className="h-9 w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Male Voices</SelectLabel>
                        {SUPPORTED_VOICES.filter((v) => v.gender === "male").map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name} — {v.description}</SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Female Voices</SelectLabel>
                        {SUPPORTED_VOICES.filter((v) => v.gender === "female").map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.name} — {v.description}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">TTS engine</Label>
                  <Select value={ttsEngine} onValueChange={setTtsEngine} disabled={isDubRunning}>
                    <SelectTrigger className="h-9 w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_ENGINES.map((e) => (
                        <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground px-0">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced options
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  <div className="space-y-1.5 max-w-sm">
                    <Label className="text-xs">Avatar ID (optional — uses the job's default avatar if left blank)</Label>
                    <Input
                      value={avatarId}
                      onChange={(e) => setAvatarId(e.target.value)}
                      placeholder="e.g. avatar_6c88c05a"
                      className="h-9"
                      disabled={isDubRunning}
                    />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox checked={skipAvatar} onCheckedChange={(v) => setSkipAvatar(!!v)} disabled={isDubRunning} />
                      Skip avatar generation
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox checked={skipSectionMerge} onCheckedChange={(v) => setSkipSectionMerge(!!v)} disabled={isDubRunning} />
                      Skip section merge
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox checked={skipFinalMerge} onCheckedChange={(v) => setSkipFinalMerge(!!v)} disabled={isDubRunning} />
                      Skip final merge
                    </label>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Button
                onClick={handleStartDubbing}
                disabled={isTriggering || isDubRunning || selectedLanguages.length === 0}
                className="gap-2"
              >
                {isTriggering || isDubRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Languages className="h-4 w-4" />
                )}
                {isDubRunning ? "Dubbing in progress..." : "Start Dubbing"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {selectedJob && dubState !== "idle" && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Label className="text-sm font-medium">Status</Label>
            {dubState === "processing" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {dubProgressMessage || "Dubbing in progress..."}
              </div>
            )}
            {dubState === "failed" && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {dubError || "Dubbing failed"}
              </div>
            )}
            {dubState === "completed" && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Dubbing complete
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {dubbedLanguages.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Label className="text-sm font-medium">Available dubbed languages</Label>
            <div className="flex flex-wrap gap-3">
              {dubbedLanguages.map((entry) => (
                <a
                  key={entry.lang}
                  href={videoUrlFor(entry)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors text-sm"
                >
                  <PlayCircle className="h-4 w-4 text-primary" />
                  {languageName(entry.lang)}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DubbingStatusList({ subjectId, defaultServerIp }: { subjectId: string; defaultServerIp: string }) {
  const { data: jobs, isLoading } = useDubbingJobs(subjectId);

  return (
    <div className="space-y-4">
      <DubbingBatchRunStatusCard subjectId={subjectId} />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading dubbing jobs...
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground py-8">
            No dubbing jobs have been triggered for this subject yet.
          </CardContent>
        </Card>
      ) : (
      <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Video</TableHead>
              <TableHead>Languages</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Triggered</TableHead>
              <TableHead>Results</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job: DubbingJob) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">{job.document_name || "Untitled document"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {job.languages.map((l) => (
                      <Badge key={l} variant="outline" className="text-xs">{l}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(job.status)} className="gap-1">
                    {statusIcon(job.status)}
                    {job.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">
                  {job.status === "failed" ? job.error_message : job.progress_message || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(job.created_at), "PPp")}
                </TableCell>
                <TableCell>
                  {job.dubbed_languages && job.dubbed_languages.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {job.dubbed_languages.map((entry) => (
                        <a
                          key={entry.lang}
                          href={`http://${job.server_ip || defaultServerIp}:5006/player/jobs/${job.external_job_id}/${entry.video_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          {entry.lang}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      </Card>
      )}
    </div>
  );
}

const batchItemStatusLabel: Record<string, string> = {
  queued: "Queued",
  processing: "Dubbing…",
  completed: "Completed",
  stopped: "Stopped",
};

function batchItemStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "stopped") return "destructive";
  if (status === "processing") return "secondary";
  return "outline";
}

// A chapter's own topic checklist — split into its own component (rather
// than looping useChapterTopics inside a .map()) so the hook is called
// unconditionally once per chapter instance, not conditionally inside a loop.
function ChapterTopicChecklist({
  chapterId,
  chapterNumber,
  chapterTitle,
  selectedTopicIds,
  onToggleTopic,
  onToggleAllInChapter,
  topicHasPublishedJob,
}: {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  selectedTopicIds: Set<string>;
  onToggleTopic: (topicId: string, topicTitle: string, chapterTitle: string) => void;
  onToggleAllInChapter: (topics: { id: string; title: string }[], chapterTitle: string, selectAll: boolean) => void;
  topicHasPublishedJob: (topicId: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: topics } = useChapterTopics(expanded ? chapterId : undefined);

  const dubbableTopics = useMemo(
    () => (topics || []).filter((t) => topicHasPublishedJob(t.id)),
    [topics, topicHasPublishedJob]
  );
  const selectedInChapter = dubbableTopics.filter((t) => selectedTopicIds.has(t.id)).length;
  const allSelected = dubbableTopics.length > 0 && selectedInChapter === dubbableTopics.length;

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Ch {chapterNumber}: {chapterTitle}
        </span>
        {selectedInChapter > 0 && (
          <Badge variant="secondary" className="text-xs">{selectedInChapter} selected</Badge>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 border-t pt-2">
          {!topics ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading topics...
            </div>
          ) : dubbableTopics.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">No published videos in this chapter yet.</p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs cursor-pointer pb-1 border-b mb-1">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() =>
                    onToggleAllInChapter(
                      dubbableTopics.map((t) => ({ id: t.id, title: t.title })),
                      chapterTitle,
                      !allSelected
                    )
                  }
                />
                <span className="font-medium">Select all in this chapter</span>
              </label>
              {dubbableTopics.map((topic) => (
                <label key={topic.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                  <Checkbox
                    checked={selectedTopicIds.has(topic.id)}
                    onCheckedChange={() => onToggleTopic(topic.id, topic.title, chapterTitle)}
                  />
                  Topic {topic.topic_number}: {topic.title}
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The detailed per-topic status card — lives in the Status tab, not the
// Auto Pipeline tab (which only shows a lightweight progress bar).
function DubbingBatchRunStatusCard({ subjectId }: { subjectId: string }) {
  const { run, stopRun, resumeRun, dismissRun } = useDubbingBatchRun(subjectId);
  if (!run) return null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={run.status === "running" ? "secondary" : run.status === "completed" ? "default" : "destructive"}>
              {run.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Auto Pipeline — {run.items.length} total ·{" "}
              {run.items.filter((i) => i.status === "queued").length} queued ·{" "}
              {run.items.filter((i) => i.status === "processing").length} active ·{" "}
              {run.items.filter((i) => i.status === "completed").length} done ·{" "}
              {run.items.filter((i) => i.status === "stopped").length} stopped
            </span>
          </div>
          <div className="flex items-center gap-2">
            {run.status === "running" && (
              <Button variant="destructive" size="sm" onClick={() => stopRun(run.id)} className="gap-1.5">
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            )}
            {run.status === "stopped" && (
              <Button variant="outline" size="sm" onClick={() => resumeRun(run.id)} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Resume
              </Button>
            )}
            {run.status !== "running" && (
              <Button variant="ghost" size="sm" onClick={() => dismissRun(run.id)} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
        {run.last_tick_at && (
          <p className="text-xs text-muted-foreground">
            Last tick: {format(new Date(run.last_tick_at), "pp")}
          </p>
        )}
        <ol className="space-y-1.5">
          {run.items.map((item, idx) => (
            <li
              key={item.topicId}
              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-sm ${
                idx === run.current_index && run.status === "running" ? "bg-muted/40 border-primary/30" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {idx + 1}. {item.topicTitle}
                </div>
                {item.chapterTitle && (
                  <div className="text-xs text-muted-foreground truncate">{item.chapterTitle}</div>
                )}
                {idx === run.current_index && item.status === "processing" && item.progressMessage && (
                  <div className="text-xs text-muted-foreground">{item.progressMessage}</div>
                )}
                {item.status === "stopped" && item.errorMessage && (
                  <div className="text-xs text-destructive">{item.errorMessage}</div>
                )}
              </div>
              <Badge variant={batchItemStatusVariant(item.status)} className="shrink-0 gap-1">
                {item.status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
                {batchItemStatusLabel[item.status] || item.status}
              </Badge>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function DubbingBatchPipeline({
  subjectId,
  subjectName,
  defaultServerIp,
}: {
  subjectId: string;
  subjectName: string;
  defaultServerIp: string;
}) {
  const { data: chapters } = useSubjectChapters(subjectId);
  const { data: allJobs } = useVideoGenerationJobs({ subjectId, status: "completed" });
  const { run, isLoading: runLoading } = useDubbingBatchRun(subjectId);

  // Most recent published+completed job per topic (allJobs is already
  // ordered newest-first), used both to gate which topics are selectable
  // and to resolve each selected topic into an actual dub-able job.
  const publishedJobByTopic = useMemo(() => {
    const map = new Map<string, VideoJobWithDocument>();
    (allJobs || []).forEach((job) => {
      const topicId = job.ai_assistant_documents?.topic_id;
      if (topicId && job.is_published === true && !map.has(topicId)) {
        map.set(topicId, job);
      }
    });
    return map;
  }, [allJobs]);

  const topicHasPublishedJob = useCallback(
    (topicId: string) => publishedJobByTopic.has(topicId),
    [publishedJobByTopic]
  );

  const [selectedTopics, setSelectedTopics] = useState<Map<string, { title: string; chapterTitle: string }>>(new Map());

  const toggleTopic = (topicId: string, topicTitle: string, chapterTitle: string) => {
    setSelectedTopics((prev) => {
      const next = new Map(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.set(topicId, { title: topicTitle, chapterTitle });
      return next;
    });
  };

  const toggleAllInChapter = (
    topics: { id: string; title: string }[],
    chapterTitle: string,
    selectAll: boolean
  ) => {
    setSelectedTopics((prev) => {
      const next = new Map(prev);
      topics.forEach((t) => {
        if (selectAll) next.set(t.id, { title: t.title, chapterTitle });
        else next.delete(t.id);
      });
      return next;
    });
  };

  // Shared dub config applied to every topic in the batch.
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [speaker, setSpeaker] = useState(DEFAULT_SPEAKER);
  const [ttsEngine, setTtsEngine] = useState<string>("edgetts");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [avatarId, setAvatarId] = useState("");
  const [skipAvatar, setSkipAvatar] = useState(false);
  const [skipSectionMerge, setSkipSectionMerge] = useState(false);
  const [skipFinalMerge, setSkipFinalMerge] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const toggleLanguage = (code: string) => {
    setSelectedLanguages((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const hasActiveRun = !!run && (run.status === "running" || run.status === "stopped");

  const handleStart = async () => {
    if (selectedTopics.size === 0) {
      toast.error("Select at least one topic");
      return;
    }
    if (selectedLanguages.length === 0) {
      toast.error("Pick at least one language");
      return;
    }

    setIsStarting(true);
    try {
      const items: DubbingBatchItem[] = [];
      const skipped: string[] = [];
      for (const [topicId, meta] of selectedTopics) {
        const job = publishedJobByTopic.get(topicId);
        if (!job?.external_job_id) {
          skipped.push(meta.title);
          continue;
        }
        items.push({
          topicId,
          topicTitle: meta.title,
          chapterTitle: meta.chapterTitle,
          videoJobId: job.id,
          externalJobId: job.external_job_id,
          documentName: job.document_name,
          serverIp: job.server_ip || defaultServerIp,
          status: "queued",
        });
      }

      if (skipped.length > 0) {
        toast.warning(`Skipped ${skipped.length} topic(s) with no published video`, {
          description: skipped.join(", "),
        });
      }
      if (items.length === 0) {
        toast.error("None of the selected topics have a published video to dub");
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("auto_submission_runs" as any).insert([{
        subject_id: subjectId,
        subject_name: subjectName,
        server_ip: defaultServerIp,
        status: "running",
        items: items as any,
        current_index: 0,
        created_by: user?.id,
        kind: "dubbing_batch",
        pipeline_config: {
          languages: selectedLanguages,
          speaker,
          tts_engine: ttsEngine,
          ...(avatarId.trim() ? { avatar_id: avatarId.trim() } : {}),
          skip_avatar: skipAvatar,
          skip_section_merge: skipSectionMerge,
          skip_final_merge: skipFinalMerge,
        },
      }]);

      if (error) {
        toast.error("Couldn't start pipeline", { description: error.message });
        return;
      }

      supabase.functions.invoke("dubbing-batch-tick").catch(() => {});
      toast.success(`Pipeline started for ${items.length} topic(s) — it will keep running on the server.`);
      setSelectedTopics(new Map());
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-muted/20">
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2 mb-2">
                <ListTree className="h-4 w-4 text-muted-foreground" />
                1. Select chapters &amp; topics to dub ({selectedTopics.size} selected)
              </Label>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {chapters?.map((chapter) => (
                  <ChapterTopicChecklist
                    key={chapter.id}
                    chapterId={chapter.id}
                    chapterNumber={chapter.chapter_number}
                    chapterTitle={chapter.title}
                    selectedTopicIds={new Set(selectedTopics.keys())}
                    onToggleTopic={toggleTopic}
                    onToggleAllInChapter={toggleAllInChapter}
                    topicHasPublishedJob={topicHasPublishedJob}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                2. Target languages (applied to every selected topic)
              </Label>
              <div className="flex flex-wrap gap-2">
                {DUB_LANGUAGES.map((lang) => (
                  <Badge
                    key={lang.code}
                    variant={selectedLanguages.includes(lang.code) ? "default" : "outline"}
                    className="cursor-pointer hover:bg-primary/80 transition-colors"
                    onClick={() => toggleLanguage(lang.code)}
                  >
                    {lang.flag} {lang.name}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Mic className="h-3.5 w-3.5 text-muted-foreground" />
                  Speaker
                </Label>
                <Select value={speaker} onValueChange={setSpeaker}>
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Male Voices</SelectLabel>
                      {SUPPORTED_VOICES.filter((v) => v.gender === "male").map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name} — {v.description}</SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Female Voices</SelectLabel>
                      {SUPPORTED_VOICES.filter((v) => v.gender === "female").map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name} — {v.description}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">TTS engine</Label>
                <Select value={ttsEngine} onValueChange={setTtsEngine}>
                  <SelectTrigger className="h-9 w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TTS_ENGINES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground px-0">
                  <Settings2 className="h-3.5 w-3.5" />
                  Advanced options
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-3">
                <div className="space-y-1.5 max-w-sm">
                  <Label className="text-xs">Avatar ID (optional — uses each job's default avatar if left blank)</Label>
                  <Input
                    value={avatarId}
                    onChange={(e) => setAvatarId(e.target.value)}
                    placeholder="e.g. avatar_6c88c05a"
                    className="h-9"
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={skipAvatar} onCheckedChange={(v) => setSkipAvatar(!!v)} />
                    Skip avatar generation
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={skipSectionMerge} onCheckedChange={(v) => setSkipSectionMerge(!!v)} />
                    Skip section merge
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={skipFinalMerge} onCheckedChange={(v) => setSkipFinalMerge(!!v)} />
                    Skip final merge
                  </label>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Button onClick={handleStart} disabled={isStarting || hasActiveRun} className="gap-2">
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Start Pipeline {selectedTopics.size > 0 && `(${selectedTopics.size} topics)`}
            </Button>
            {hasActiveRun && (
              <p className="text-xs text-muted-foreground">
                A pipeline is already {run?.status} for this subject — check the Status tab, or stop/dismiss it
                there before starting a new one.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Topics are dubbed one at a time, in order. If one fails, the pipeline stops there — later topics
              are not submitted until you resume. Runs on the server every minute, even with this tab closed.
            </p>
          </CardContent>
      </Card>

      {runLoading && !run && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking for an active pipeline...
        </div>
      )}

      {run && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium flex items-center gap-2">
                <Badge variant={run.status === "running" ? "secondary" : run.status === "completed" ? "default" : "destructive"}>
                  {run.status}
                </Badge>
                Pipeline running on the server
              </span>
              <span className="text-xs text-muted-foreground">
                {run.items.filter((i) => i.status === "completed").length} / {run.items.length} completed
              </span>
            </div>
            <Progress
              value={(run.items.filter((i) => i.status === "completed").length / Math.max(run.items.length, 1)) * 100}
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              Full per-topic status, and Stop/Resume controls, are in the <strong>Status</strong> tab.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
