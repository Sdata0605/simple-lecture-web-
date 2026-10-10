import { useEffect, useRef, useState } from "react";
import { GraduationCap, Headphones, Loader2, Mic, MicOff, PhoneCall, PhoneOff, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { QuizCard } from "./QuizCard";
import type { useLiveTeacher } from "./useLiveTeacher";

type Live = ReturnType<typeof useLiveTeacher>;

/** Voice class as a single chat: spoken text, slides and quiz questions all appear in the same stream. */
export function VoiceMode({ live, subjectName }: { live: Live; subjectName: string | null }) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { status } = live;
  const inCall = status === "live" || status === "connecting";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [live.transcript]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    if (status === "live" || status === "connecting") live.sendText(t); // queued until the line is open
    else void live.connect(t);
  };

  const statusText =
    status === "connecting" ? "Connecting to your teacher…"
    : status === "live" ? (live.speaking ? `${live.teacherName} is speaking…` : live.muted ? "Your microphone is muted" : live.micAvailable ? "Listening… go ahead and speak" : "Type your question below")
    : status === "ended" ? "Class ended"
    : status === "error" ? "Could not connect"
    : "Tap Start class and your teacher will ask what you want to study";

  const ring = live.speaking ? 6 : Math.round(live.micLevel * 12);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Teacher bar */}
      <div className="shrink-0 border-b px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
            {live.speaking && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />}
            <div
              className={cn("relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-emerald-800 text-white transition-all", status !== "live" && "opacity-80")}
              style={{ boxShadow: `0 0 0 ${ring}px rgba(16,185,129,0.25)` }}
            >
              <GraduationCap className="h-5 w-5" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">
              {live.teacherName}{subjectName ? <span className="font-normal text-muted-foreground"> · {subjectName}</span> : null}
            </p>
            <p className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground" aria-live="polite">
              {status === "connecting" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              <span className="line-clamp-2">{statusText}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!inCall ? (
              <Button size="sm" onClick={() => void live.connect()} className="gap-1.5 bg-emerald-700 hover:bg-emerald-800">
                <PhoneCall className="h-4 w-4" /><span>{status === "ended" || status === "error" ? "New class" : "Start class"}</span>
              </Button>
            ) : (
              <>
                {live.micAvailable && (
                  <Button size="icon" variant="outline" onClick={live.toggleMute} aria-pressed={live.muted} aria-label={live.muted ? "Unmute" : "Mute"} className="h-9 w-9">
                    {live.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={live.disconnect} className="gap-1.5"><PhoneOff className="h-4 w-4" /><span className="hidden sm:inline">End class</span></Button>
              </>
            )}
          </div>
        </div>
        {live.error && <p role="alert" className="mt-2 text-sm text-destructive">{live.error}</p>}
        {live.notice && !live.error && <p className="mt-2 text-xs text-amber-700">{live.notice}</p>}
      </div>

      {/* The conversation: only this part scrolls */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {live.transcript.length === 0 ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Headphones className="h-6 w-6" />
            <p>Your conversation with the teacher will appear here, including quiz questions. Headphones work best.</p>
          </div>
        ) : (
          live.transcript.map((m) => {
            if (m.kind === "quiz") {
              return (
                <div key={m.id} className="flex gap-2.5">
                  <Avatar teacher />
                  <div className="min-w-0 max-w-[92%] flex-1"><QuizCard quiz={m.quiz} onAnswer={(i) => live.reportQuizAnswer(m.quiz, i)} /></div>
                </div>
              );
            }
            if (m.kind === "slide") {
              return (
                <div key={m.id} className="flex gap-2.5">
                  <Avatar teacher />
                  <section className="min-w-0 max-w-[92%] rounded-2xl border bg-gradient-to-br from-emerald-50 to-white p-3.5 shadow-sm">
                    <h3 className="mb-1.5 text-sm font-semibold text-emerald-900">{m.title}</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm">{m.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  </section>
                </div>
              );
            }
            const mine = m.role === "user";
            return (
              <div key={m.id} className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
                <Avatar teacher={!mine} />
                <p className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "border bg-background")}>{m.text}</p>
              </div>
            );
          })
        )}
      </div>

      {/* Input stays pinned to the bottom */}
      <form onSubmit={submit} className="flex shrink-0 gap-2 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={inCall ? "Type to your teacher…" : "Type a question to start class…"}
          aria-label="Type a question"
          maxLength={500}
          className="h-11 text-base md:text-sm"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </section>
  );
}

function Avatar({ teacher }: { teacher?: boolean }) {
  return (
    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", teacher ? "bg-emerald-100 text-emerald-700" : "bg-primary text-primary-foreground")}>
      {teacher ? <GraduationCap className="h-4 w-4" /> : <User className="h-4 w-4" />}
    </div>
  );
}
