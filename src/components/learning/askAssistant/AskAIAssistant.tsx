// "Ask AI" inside the lecture player. The student talks, by voice, to the same live AI Teacher as /aiteacher
// (Gemini Live: the teacher's own voice, answers grounded in the knowledge index, quiz/visual cards), but the
// teacher is told which lecture is paused and where. There are no pre-recorded clips: every word the
// student hears is the teacher speaking.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Lock, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useAITeacherSubscription } from "@/lib/aiTeacherSubscription";
import { usePrefs } from "@/lib/aiTeacherPrefs";
import type { TeacherSubject } from "@/lib/aiTeacherApi";
import {
  buildLectureOpening,
  visibleStudentText,
  withFirstQuestion,
  type LectureAskContext,
} from "@/lib/aiTeacherLecture";
import { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import { VoiceMode } from "@/components/aiteacher/VoiceMode";

export interface AskAIAssistantProps {
  /** "mid" = opened from the player's Ask AI button, "end" = lecture just finished. */
  trigger: "mid" | "end";
  onClose: () => void;
  subject: TeacherSubject;
  topicTitle?: string | null;
  /** Language the lecture is playing in, e.g. "kannada". */
  lectureLanguage?: string | null;
  /** Where the lecture was paused (mid-lecture only). */
  context?: LectureAskContext | null;
}

const noop = () => {};

export function AskAIAssistant(props: AskAIAssistantProps) {
  const { onClose, subject, topicTitle } = props;
  const { isAuthenticated, isLoading } = useAuth();
  const { hasActivePlan } = useAITeacherSubscription();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: JSX.Element;
  if (isLoading) {
    body = <Notice icon={<Loader2 className="h-6 w-6 animate-spin" />} title="Getting your teacher ready…" />;
  } else if (!isAuthenticated) {
    body = (
      <Notice
        icon={<Lock className="h-6 w-6" />}
        title="Log in to talk to your AI teacher"
        text="Your AI teacher answers your doubts by voice while you watch."
        action={{ label: "Log in", onClick: () => window.open("/auth?tab=login", "_blank", "noopener") }}
      />
    );
  } else if (!hasActivePlan) {
    body = (
      <Notice
        icon={<Lock className="h-6 w-6" />}
        title="Voice doubts need an AI Teacher plan"
        text="Talk to your AI teacher out loud and get answers from your own course notes, right in the lecture."
        action={{ label: "See AI Teacher plans", onClick: () => window.open("/aiteacher", "_blank", "noopener") }}
      />
    );
  } else {
    body = <LiveLecture {...props} />;
  }

  return createPortal(
    // Above V5Player (z-index 9999).
    <div className="fixed inset-0 z-[10000] flex h-[100dvh] flex-col bg-background" role="dialog" aria-modal="true" aria-label="Ask your AI teacher">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 sm:px-4">
        <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          Ask AI <span className="font-normal text-muted-foreground">· {subject.name}{topicTitle ? ` · ${topicTitle}` : ""}</span>
        </p>
        <Button size="sm" onClick={onClose} className="gap-1.5 bg-emerald-700 hover:bg-emerald-800">
          <Play className="h-4 w-4" /> Resume lecture
        </Button>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-2 sm:p-4">{body}</main>
    </div>,
    document.body,
  );
}

/** Starts the live call as soon as it opens and shows the teacher's conversation. */
function LiveLecture({ trigger, subject, topicTitle, lectureLanguage, context }: AskAIAssistantProps) {
  const [prefs] = usePrefs();
  const [subjects] = useState(() => [subject]);
  const [opening] = useState(() =>
    buildLectureOpening({
      trigger,
      subjectName: subject.name,
      topicTitle,
      lectureLanguage,
      replyInLectureLanguage: prefs.language === "auto",
      context,
    }),
  );

  // `enrolledSubjects` scopes the teacher to this subject, like the old assistant's "outside this subject" reply.
  const live = useLiveTeacher({ subject, subjects, onSubject: noop, prefs, enrolledSubjects: subject.name });

  // Deferred a tick so a dev-time remount cancels it instead of opening two calls.
  const connectRef = useRef(live.connect);
  connectRef.current = live.connect;
  useEffect(() => {
    const t = window.setTimeout(() => void connectRef.current(opening), 0);
    return () => window.clearTimeout(t);
  }, [opening]);

  // The context message is plumbing; the student only sees their own words. A restart (or a question typed
  // before the call was up) must carry the lecture context too, so connect() is wrapped.
  const transcript = live.transcript.flatMap((item) => {
    if (item.kind !== "text" || item.role !== "user") return [item];
    const text = visibleStudentText(item.text);
    return text === null ? [] : [text === item.text ? item : { ...item, text }];
  });
  const view = {
    ...live,
    status: live.status === "idle" ? ("connecting" as const) : live.status,
    transcript,
    connect: (first?: string) => live.connect(withFirstQuestion(opening, first)),
  };

  return <VoiceMode live={view} subjectName={subject.name} />;
}

function Notice({
  icon,
  title,
  text,
  action,
}: {
  icon: JSX.Element;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">{icon}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      {text && <p className="text-sm text-muted-foreground">{text}</p>}
      {action && (
        <Button onClick={action.onClick} className="bg-emerald-700 hover:bg-emerald-800">
          {action.label}
        </Button>
      )}
    </div>
  );
}
