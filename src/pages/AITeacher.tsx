import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, MessageSquareText, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { teacherApi, type TeacherSubject } from "@/lib/aiTeacherApi";
import { VoiceMode } from "@/components/aiteacher/VoiceMode";
import { ChatMode } from "@/components/aiteacher/ChatMode";
import { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";

type Mode = "voice" | "chat";

/**
 * Tracks the visible area of the screen. On phones the on-screen keyboard shrinks it; sizing the
 * page to it keeps the text box right above the keyboard instead of scrolling away with the content.
 */
function useVisualViewport() {
  const read = () => {
    const vv = window.visualViewport;
    return { height: vv?.height ?? window.innerHeight, top: vv?.offsetTop ?? 0 };
  };
  const [box, setBox] = useState(read);
  useEffect(() => {
    const update = () => setBox(read());
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return box;
}

export default function AITeacher() {
  // No subject is picked up front: the teacher asks, and the student answers by voice or text.
  const [subject, setSubject] = useState<TeacherSubject | null>(null);
  const [mode, setMode] = useState<Mode>("voice");
  const viewport = useVisualViewport();

  useEffect(() => { document.title = "AI Teacher 1-to-1 | SimpleLecture"; }, []);

  // The page is a fixed, full-screen app: only the conversation scrolls, never the page.
  useEffect(() => {
    const html = document.documentElement;
    const prev = { htmlOverflow: html.style.overflow, bodyOverflow: document.body.style.overflow, overscroll: html.style.overscrollBehavior };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      document.body.style.overflow = prev.bodyOverflow;
      html.style.overscrollBehavior = prev.overscroll;
    };
  }, []);

  const subjectsQ = useQuery({
    queryKey: ["ai-teacher", "subjects"],
    queryFn: async () => (await teacherApi<{ subjects: TeacherSubject[] }>("subjects")).subjects,
    staleTime: 5 * 60_000,
  });
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data]);

  const live = useLiveTeacher({ subject, subjects, onSubject: setSubject });
  const { disconnect, status } = live;

  const clearSubject = () => {
    setSubject(null);
    if (status === "live") live.sendText("I want to change the subject. Please ask me which subject I want to study.", { silent: true });
  };

  const changeMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "chat") disconnect(); // never leave a voice call running in the background
    setMode(m);
  };

  const ModeButton = ({ m, icon: Icon, label }: { m: Mode; icon: typeof Mic; label: string }) => (
    <button
      type="button"
      onClick={() => changeMode(m)}
      aria-pressed={mode === m}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none",
        mode === m ? "bg-emerald-700 text-white shadow" : "text-muted-foreground hover:bg-accent",
      )}
    >
      <Icon className="h-4 w-4" />{label}
    </button>
  );

  return (
    <div
      className="fixed inset-x-0 flex flex-col bg-gradient-to-b from-emerald-50/70 via-background to-background"
      style={{ top: viewport.top, height: viewport.height }}
    >
      <header className="shrink-0 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-emerald-800">
            <GraduationCap className="h-6 w-6" /><span>SimpleLecture</span>
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">AI Teacher · 1-to-1</span>

          {subject && (
            <span className="ml-auto flex items-center gap-1 rounded-full border bg-emerald-50 py-0.5 pl-3 pr-1 text-sm text-emerald-900 sm:order-last sm:ml-0">
              {subject.name}
              <button type="button" onClick={clearSubject} className="rounded-full p-1 hover:bg-emerald-100" aria-label="Change subject" title="Change subject">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}

          <div className="flex w-full rounded-full border bg-muted/50 p-1 sm:ml-auto sm:w-auto" role="group" aria-label="Mode">
            <ModeButton m="voice" icon={Mic} label="Voice Teacher" />
            <ModeButton m="chat" icon={MessageSquareText} label="Chat" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-2 py-2 sm:px-4 sm:py-3">
        {subjectsQ.isLoading ? (
          <p className="p-10 text-center text-muted-foreground">Loading your teacher…</p>
        ) : subjectsQ.isError ? (
          <div className="p-10 text-center">
            <p className="mb-3 text-destructive">The AI Teacher could not be reached right now.</p>
            <Button variant="outline" onClick={() => subjectsQ.refetch()}>Try again</Button>
          </div>
        ) : subjects.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">No subjects are available yet. Please check back soon.</p>
        ) : (
          <>
            {/* Both modes stay mounted so switching tabs does not lose the conversation. */}
            <div className={cn("min-h-0 flex-1 flex-col", mode === "voice" ? "flex" : "hidden")}>
              <VoiceMode live={live} subjectName={subject?.name ?? null} />
            </div>
            <div className={cn("min-h-0 flex-1 flex-col", mode === "chat" ? "flex" : "hidden")}>
              <ChatMode subjects={subjects} subject={subject} onSubject={setSubject} request={null} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
