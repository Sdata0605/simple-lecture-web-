import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, ListTree, MessageSquareText, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { teacherApi, type OutlineChapter, type TeacherSubject } from "@/lib/aiTeacherApi";
import { Syllabus, type PickedTopic } from "@/components/aiteacher/Syllabus";
import { VoiceMode } from "@/components/aiteacher/VoiceMode";
import { ChatMode, type ChatRequest } from "@/components/aiteacher/ChatMode";
import { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";

type Mode = "voice" | "chat";

export default function AITeacher() {
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("voice");
  const [showSyllabus, setShowSyllabus] = useState(false);
  const [chatRequest, setChatRequest] = useState<ChatRequest | null>(null);

  useEffect(() => { document.title = "AI Teacher 1-to-1 | SimpleLecture"; }, []);

  const subjectsQ = useQuery({
    queryKey: ["ai-teacher", "subjects"],
    queryFn: async () => (await teacherApi<{ subjects: TeacherSubject[] }>("subjects")).subjects,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!subjectId && subjectsQ.data?.length) setSubjectId(subjectsQ.data[0].id);
  }, [subjectId, subjectsQ.data]);

  const subject = useMemo(() => subjectsQ.data?.find((s) => s.id === subjectId) ?? null, [subjectsQ.data, subjectId]);

  const outlineQ = useQuery({
    queryKey: ["ai-teacher", "outline", subjectId],
    enabled: !!subjectId,
    queryFn: async () => (await teacherApi<{ chapters: OutlineChapter[] }>("outline", { subjectId })).chapters,
    staleTime: 10 * 60_000,
  });

  const live = useLiveTeacher(subject ? { id: subject.id, name: subject.name } : null);
  const { disconnect, reset, status } = live;

  const changeSubject = (id: string) => {
    disconnect();
    reset();
    setChatRequest(null);
    setSubjectId(id);
  };

  const changeMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "chat") disconnect(); // never leave a voice call running in the background
    setMode(m);
  };

  const pickTopic = useCallback((t: PickedTopic) => {
    setShowSyllabus(false);
    if (mode === "chat") {
      setChatRequest({ nonce: Date.now(), text: `Teach me the lesson: ${t.title} (chapter: ${t.chapterTitle})`, topicId: t.id });
      return;
    }
    const msg = `Please teach me the lesson "${t.title}" from the chapter "${t.chapterTitle}". Search the notes and teach it step by step.`;
    void live.preloadTopic(t.id);
    if (status === "live" || status === "connecting") live.sendText(msg);
    else void live.connect(msg);
  }, [mode, live, status]);

  const ModeButton = ({ m, icon: Icon, label }: { m: Mode; icon: typeof Mic; label: string }) => (
    <button
      type="button"
      onClick={() => changeMode(m)}
      aria-pressed={mode === m}
      className={cn(
        "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
        mode === m ? "bg-emerald-700 text-white shadow" : "text-muted-foreground hover:bg-accent",
      )}
    >
      <Icon className="h-4 w-4" />{label}
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/70 via-background to-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-emerald-800">
            <GraduationCap className="h-6 w-6" /><span>SimpleLecture</span>
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">AI Teacher · 1-to-1</span>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="flex rounded-full border bg-muted/50 p-1" role="group" aria-label="Mode">
              <ModeButton m="voice" icon={Mic} label="Voice Teacher" />
              <ModeButton m="chat" icon={MessageSquareText} label="Chat" />
            </div>
            {subjectsQ.data && subjectsQ.data.length > 0 && (
              <Select value={subjectId ?? undefined} onValueChange={changeSubject}>
                <SelectTrigger className="w-[180px]" aria-label="Subject"><SelectValue placeholder="Subject" /></SelectTrigger>
                <SelectContent className="bg-background">
                  {subjectsQ.data.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" className="gap-2 lg:hidden" onClick={() => setShowSyllabus((v) => !v)} aria-expanded={showSyllabus}>
              <ListTree className="h-4 w-4" />Lessons
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 gap-4 px-4 py-4 lg:h-[calc(100vh-65px)]">
        <aside className={cn("w-full shrink-0 lg:block lg:w-72", showSyllabus ? "block" : "hidden", "lg:overflow-auto")}>
          <div className="rounded-2xl border bg-card p-3 shadow-sm">
            <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold"><ListTree className="h-4 w-4" />Lessons — tap to learn</h2>
            <Syllabus chapters={outlineQ.data} loading={outlineQ.isLoading} onPick={pickTopic} />
          </div>
        </aside>

        <div className={cn("flex min-w-0 flex-1 flex-col", showSyllabus && "hidden lg:flex")}>
          {subjectsQ.isLoading ? (
            <p className="p-10 text-center text-muted-foreground">Loading your teacher…</p>
          ) : subjectsQ.isError ? (
            <div className="p-10 text-center">
              <p className="mb-3 text-destructive">The AI Teacher could not be reached right now.</p>
              <Button variant="outline" onClick={() => subjectsQ.refetch()}>Try again</Button>
            </div>
          ) : !subject ? (
            <p className="p-10 text-center text-muted-foreground">No subjects are available yet. Please check back soon.</p>
          ) : mode === "voice" ? (
            <VoiceMode live={live} subjectName={subject.name} />
          ) : (
            <ChatMode key={subject.id} subjectId={subject.id} subjectName={subject.name} outline={outlineQ.data} request={chatRequest} />
          )}
        </div>
      </main>
    </div>
  );
}
