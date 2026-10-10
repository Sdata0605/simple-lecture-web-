import { useEffect, useRef, useState } from "react";
import { GraduationCap, Headphones, Loader2, Mic, MicOff, PhoneCall, PhoneOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PresentationPanel } from "./PresentationPanel";
import type { useLiveTeacher } from "./useLiveTeacher";

type Live = ReturnType<typeof useLiveTeacher>;

export function VoiceMode({ live, subjectName }: { live: Live; subjectName: string }) {
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
    if (status === "live") live.sendText(t);
    else if (status === "connecting") live.sendText(t); // queued until the line is open
    else void live.connect(t);
  };

  const statusText =
    status === "connecting" ? "Connecting to your teacher…"
    : status === "live" ? (live.speaking ? `${live.teacherName} is speaking…` : live.muted ? "Your microphone is muted" : live.micAvailable ? "Listening… go ahead and speak" : "Type your question below")
    : status === "ended" ? "Class ended"
    : status === "error" ? "Could not connect"
    : "Press Start class and just talk, or type a question";

  const ring = live.speaking ? 12 : Math.round(live.micLevel * 22);

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
      {/* Teacher side */}
      <section className="flex min-h-[420px] flex-col rounded-2xl border bg-card p-4 shadow-sm lg:min-h-0">
        <div className="flex flex-col items-center gap-3 pb-3">
          <div className="relative flex h-28 w-28 items-center justify-center">
            {live.speaking && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />}
            <div
              className={cn("relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-emerald-800 text-white transition-all", status !== "live" && "opacity-80")}
              style={{ boxShadow: `0 0 0 ${ring}px rgba(16,185,129,0.25)` }}
            >
              <GraduationCap className="h-11 w-11" />
            </div>
          </div>
          <div className="text-center">
            <p className="font-semibold">{live.teacherName}</p>
            <p className="text-xs text-muted-foreground">{subjectName} · 1-to-1 voice class</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm" aria-live="polite">
              {status === "connecting" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {statusText}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {!inCall ? (
              <Button onClick={() => void live.connect()} className="gap-2 bg-emerald-700 hover:bg-emerald-800">
                <PhoneCall className="h-4 w-4" />{status === "ended" || status === "error" ? "Start a new class" : "Start class"}
              </Button>
            ) : (
              <>
                <Button variant="destructive" onClick={live.disconnect} className="gap-2"><PhoneOff className="h-4 w-4" />End class</Button>
                {live.micAvailable && (
                  <Button variant="outline" onClick={live.toggleMute} className="gap-2" aria-pressed={live.muted}>
                    {live.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{live.muted ? "Unmute" : "Mute"}
                  </Button>
                )}
              </>
            )}
          </div>

          {!inCall && status !== "error" && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Headphones className="h-3.5 w-3.5" />Use headphones for the best experience.</p>
          )}
          {live.error && <p role="alert" className="max-w-md text-center text-sm text-destructive">{live.error}</p>}
          {live.notice && !live.error && <p className="max-w-md text-center text-xs text-amber-700">{live.notice}</p>}
        </div>

        {/* Live transcript */}
        <div ref={scrollRef} className="min-h-[120px] flex-1 space-y-2 overflow-auto rounded-xl bg-muted/40 p-3">
          {live.transcript.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">The conversation will appear here as you talk.</p>
          ) : (
            live.transcript.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <p className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "border bg-background")}>{m.text}</p>
              </div>
            ))
          )}
        </div>

        <form onSubmit={submit} className="mt-3 flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={inCall ? "Type a question to your teacher…" : "Type a question to start class…"}
            aria-label="Type a question"
            maxLength={500}
          />
          <Button type="submit" size="icon" disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </section>

      {/* Presentation side */}
      <section className="flex min-h-[420px] min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm lg:min-h-0">
        <PresentationPanel
          board={live.board}
          references={live.references}
          documents={live.documents}
          practice={live.practice}
          onQuizAnswer={(quiz, i) => { if (status === "live") live.reportQuizAnswer(quiz, i); }}
        />
      </section>
    </div>
  );
}
