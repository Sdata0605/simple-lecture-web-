import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  useAthenaChapters,
  useAthenaDocuments,
  useAthenaQuestionCounts,
  useAthenaQuestions,
  useAthenaSubjects,
  useAthenaTopics,
  useCreateAthenaChapter,
  useCreateAthenaSubject,
  useCreateAthenaTopic,
  useUploadAthenaDocuments,
} from "@/hooks/useAthenaApi";

function timeAgo(value?: string) {
  if (!value) return "—";
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return value;
  }
}

function DocumentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ready":
      return (
        <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </Badge>
      );
    case "processing":
      return (
        <Badge className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/15 gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Processing
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    case "low_extraction":
      return <Badge className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">Low Extraction</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ---------------- New Subject dialog ----------------

function NewSubjectDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const createSubject = useCreateAthenaSubject();

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "Subject name is required", variant: "destructive" });
      return;
    }
    try {
      const created = await createSubject.mutateAsync({
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
      });
      toast({ title: "Subject created", description: created?.name });
      setOpen(false);
      setName("");
      setSlug("");
      setDescription("");
      if (created?.id) onCreated(created.id);
    } catch (err) {
      toast({ title: "Failed to create subject", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> New Subject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Athena Subject</DialogTitle>
          <DialogDescription>
            Creates a subject on the Athena AI service — used to scope document ingestion and questions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics" />
          </div>
          <div className="space-y-1.5">
            <Label>Slug (optional)</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated if left blank" />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={createSubject.isPending}>
            {createSubject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Subject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Questions tab ----------------

function QuestionsTab({ subjectId }: { subjectId: string }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"popular" | "recent">("recent");
  const [chapterFilter, setChapterFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data: chapters } = useAthenaChapters(subjectId);
  const counts = useAthenaQuestionCounts(subjectId);
  const questions = useAthenaQuestions(subjectId, {
    q: search || undefined,
    sort,
    chapterId: chapterFilter !== "all" ? chapterFilter : undefined,
    limit,
    offset,
  });

  const rows = questions.data?.questions ?? [];
  const total = questions.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{counts.data?.total ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Total questions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{counts.data?.untagged ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Untagged</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{counts.data?.by_chapter?.length ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Chapters with activity</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <div className="text-sm font-medium">Live — updates every 5s</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setOffset(0);
              setSearch(e.target.value);
            }}
            placeholder="Search questions..."
            className="pl-8"
          />
        </div>
        <Select value={chapterFilter} onValueChange={(v) => { setOffset(0); setChapterFilter(v); }}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All chapters" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All chapters</SelectItem>
            {(chapters ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v: "popular" | "recent") => { setOffset(0); setSort(v); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Most recent</SelectItem>
            <SelectItem value="popular">Most popular</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => questions.refetch()} title="Refresh now">
          <RefreshCw className={`h-4 w-4 ${questions.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Chapter / Topic</TableHead>
                <TableHead className="text-right">Uses</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead className="text-right">Asked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading questions...
                </TableCell></TableRow>
              )}
              {!questions.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No questions yet for this subject.
                </TableCell></TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.answer_id}>
                  <TableCell className="max-w-[420px]"><span className="line-clamp-2">{row.question_text}</span></TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5 text-xs">
                      {row.chapter_title && <span className="text-foreground">{row.chapter_title}</span>}
                      {row.topic_title && <span className="text-muted-foreground">{row.topic_title}</span>}
                      {!row.chapter_title && !row.topic_title && <span className="text-muted-foreground">Untagged</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{row.usage_count ?? 0}</TableCell>
                  <TableCell>
                    {row.video_ready === true && <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/15">Ready</Badge>}
                    {row.video_ready === false && <Badge variant="destructive">Failed</Badge>}
                    {row.video_ready == null && <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Generating</Badge>}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{timeAgo(row.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > limit && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{offset + 1}-{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Curriculum tab ----------------

function CurriculumTab({ subjectId }: { subjectId: string }) {
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [newChapterNumber, setNewChapterNumber] = useState("");
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicNumber, setNewTopicNumber] = useState("");

  const chapters = useAthenaChapters(subjectId);
  const topics = useAthenaTopics(selectedChapterId ?? undefined);
  const createChapter = useCreateAthenaChapter();
  const createTopic = useCreateAthenaTopic();

  const handleAddChapter = async () => {
    if (!newChapterTitle.trim()) return;
    try {
      await createChapter.mutateAsync({
        subjectId,
        title: newChapterTitle.trim(),
        chapterNumber: newChapterNumber ? Number(newChapterNumber) : undefined,
      });
      setNewChapterTitle("");
      setNewChapterNumber("");
      toast({ title: "Chapter created" });
    } catch (err) {
      toast({ title: "Failed to create chapter", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleAddTopic = async () => {
    if (!selectedChapterId || !newTopicTitle.trim()) return;
    try {
      await createTopic.mutateAsync({
        chapterId: selectedChapterId,
        title: newTopicTitle.trim(),
        topicNumber: newTopicNumber ? Number(newTopicNumber) : undefined,
      });
      setNewTopicTitle("");
      setNewTopicNumber("");
      toast({ title: "Topic created" });
    } catch (err) {
      toast({ title: "Failed to create topic", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" /> Chapters</CardTitle>
          <CardDescription>Chapters under this Athena subject.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Chapter title" value={newChapterTitle} onChange={(e) => setNewChapterTitle(e.target.value)} />
            <Input placeholder="#" className="w-16" value={newChapterNumber} onChange={(e) => setNewChapterNumber(e.target.value)} />
            <Button size="sm" onClick={handleAddChapter} disabled={createChapter.isPending}>
              {createChapter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
          <div className="space-y-1 max-h-[420px] overflow-y-auto">
            {chapters.isLoading && <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>}
            {!chapters.isLoading && (chapters.data ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">No chapters yet.</div>
            )}
            {(chapters.data ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedChapterId(c.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-left transition-colors ${
                  selectedChapterId === c.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
              >
                <span>{c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.title}</span>
                <ChevronRight className="h-4 w-4 opacity-50" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Topics</CardTitle>
          <CardDescription>
            {selectedChapterId ? "Topics under the selected chapter." : "Select a chapter to manage its topics."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedChapterId ? (
            <>
              <div className="flex gap-2">
                <Input placeholder="Topic title" value={newTopicTitle} onChange={(e) => setNewTopicTitle(e.target.value)} />
                <Input placeholder="#" className="w-16" value={newTopicNumber} onChange={(e) => setNewTopicNumber(e.target.value)} />
                <Button size="sm" onClick={handleAddTopic} disabled={createTopic.isPending}>
                  {createTopic.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
              <div className="space-y-1 max-h-[420px] overflow-y-auto">
                {topics.isLoading && <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>}
                {!topics.isLoading && (topics.data ?? []).length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center">No topics yet.</div>
                )}
                {(topics.data ?? []).map((t) => (
                  <div key={t.id} className="px-3 py-2 rounded-md text-sm bg-muted/40">
                    {t.topic_number != null ? `${t.topic_number}. ` : ""}{t.title}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">Pick a chapter on the left.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Documents tab ----------------

function DocumentsTab({ subjectId }: { subjectId: string }) {
  const [selectedChapterId, setSelectedChapterId] = useState<string>("none");
  const [selectedTopicId, setSelectedTopicId] = useState<string>("none");
  const [files, setFiles] = useState<File[]>([]);

  const chapters = useAthenaChapters(subjectId);
  const topics = useAthenaTopics(selectedChapterId !== "none" ? selectedChapterId : undefined);
  const documents = useAthenaDocuments(subjectId);
  const upload = useUploadAthenaDocuments();

  const handleUpload = async () => {
    if (files.length === 0) {
      toast({ title: "Choose at least one file", variant: "destructive" });
      return;
    }
    try {
      const res = await upload.mutateAsync({
        files,
        subjectId,
        chapterId: selectedChapterId !== "none" ? selectedChapterId : undefined,
        topicId: selectedTopicId !== "none" ? selectedTopicId : undefined,
      });
      toast({ title: "Upload started", description: `${res.uploaded?.length ?? files.length} file(s) submitted for processing.` });
      setFiles([]);
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Submit Documents</CardTitle>
          <CardDescription>PDF, DOCX, TXT or MD — chunked and embedded for this subject (optionally scoped to a chapter/topic).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Chapter (optional)</Label>
              <Select value={selectedChapterId} onValueChange={(v) => { setSelectedChapterId(v); setSelectedTopicId("none"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific chapter</SelectItem>
                  {(chapters.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Topic (optional)</Label>
              <Select value={selectedTopicId} onValueChange={setSelectedTopicId} disabled={selectedChapterId === "none"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific topic</SelectItem>
                  {(topics.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Files</Label>
            <Input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            {files.length > 0 && (
              <div className="text-xs text-muted-foreground">{files.map((f) => f.name).join(", ")}</div>
            )}
          </div>
          <Button onClick={handleUpload} disabled={upload.isPending} className="gap-2">
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Submit
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submitted Documents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.isLoading && (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!documents.isLoading && (documents.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No documents submitted yet.</TableCell></TableRow>
              )}
              {(documents.data ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.title || d.filename}</div>
                    {d.error_message && <div className="text-xs text-destructive">{d.error_message}</div>}
                  </TableCell>
                  <TableCell><DocumentStatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right">{d.total_chunks ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{timeAgo(d.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Page ----------------

export default function RealTimeQuestions() {
  const subjects = useAthenaSubjects();
  const [subjectId, setSubjectId] = useState<string | undefined>(undefined);

  const activeSubjectId = subjectId ?? subjects.data?.[0]?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Real Time Questions
          </h1>
          <p className="text-muted-foreground">
            Athena AI — live question activity, curriculum and document ingestion (admin only).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={activeSubjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder={subjects.isLoading ? "Loading subjects..." : "Select a subject"} />
            </SelectTrigger>
            <SelectContent>
              {(subjects.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} {typeof s.documents === "number" ? `(${s.documents} docs)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <NewSubjectDialog onCreated={setSubjectId} />
        </div>
      </div>

      {!activeSubjectId ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {subjects.isLoading ? (
              <><Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />Loading Athena subjects…</>
            ) : (
              <>No subjects yet on Athena. Create one to get started.</>
            )}
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="questions">
          <TabsList>
            <TabsTrigger value="questions">Questions</TabsTrigger>
            <TabsTrigger value="curriculum">Curriculum</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <TabsContent value="questions" className="mt-4">
            <QuestionsTab subjectId={activeSubjectId} />
          </TabsContent>
          <TabsContent value="curriculum" className="mt-4">
            <CurriculumTab subjectId={activeSubjectId} />
          </TabsContent>
          <TabsContent value="documents" className="mt-4">
            <DocumentsTab subjectId={activeSubjectId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
