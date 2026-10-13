// "Ask AI" inside the lecture player: a full-screen orb over the paused lecture. The student talks, by voice,
// to the same live AI Teacher as /aiteacher (Gemini Live: the teacher's own voice, answers grounded in the
// knowledge index, quiz/visual cards), and the teacher is told which lecture is paused and where. There are
// no pre-recorded clips: every word the student hears is the teacher speaking.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Lock, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAITeacherSubscription } from "@/lib/aiTeacherSubscription";
import { usePrefs } from "@/lib/aiTeacherPrefs";
import type { TeacherSubject } from "@/lib/aiTeacherApi";
import {
  buildLectureOpening,
  deriveLectureView,
  visibleStudentText,
  withFirstQuestion,
  type LectureAskContext,
} from "@/lib/aiTeacherLecture";
import { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import { LectureOrbScreen } from "./LectureOrbScreen";
import "./ask-assistant.css";

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

  let body: ReactNode;
  if (isLoading) {
    body = <Gate icon={<Loader2 size={16} className="animate-spin" />} title="Getting your teacher ready…" />;
  } else if (!isAuthenticated) {
    body = (
      <Gate
        icon={<Lock size={16} />}
        title="Log in to talk to your AI teacher"
        text="Your AI teacher answers your doubts by voice while you watch."
        action={{ label: "Log in", onClick: () => window.open("/auth?tab=login", "_blank", "noopener") }}
      />
    );
  } else if (!hasActivePlan) {
    body = (
      <Gate
        icon={<Lock size={16} />}
        title="Voice doubts need an AI Teacher plan"
        text="Talk to your AI teacher out loud and get answers from your own course notes, right in the lecture."
        action={{ label: "See AI Teacher plans", onClick: () => window.open("/aiteacher", "_blank", "noopener") }}
      />
    );
  } else {
    body = <LiveLecture {...props} />;
  }

  return createPortal(
    <div className="aa-overlay" role="dialog" aria-modal="true" aria-label="Ask your AI teacher">
      <header className="aa-topbar">
        <div className="aa-topbar__title">
          <Sparkles size={16} />
          <span>Ask AI</span>
          <span className="aa-topbar__subject">
            · {subject.name}
            {topicTitle ? ` · ${topicTitle}` : ""}
          </span>
        </div>
        <button type="button" className="aa-icon-btn" onClick={onClose} aria-label="Close and return to the lecture">
          <X size={18} />
        </button>
      </header>
      {body}
    </div>,
    document.body,
  );
}

/** Starts the live call as soon as it opens and shows the teacher on the orb screen. */
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

  // `enrolledSubjects` scopes the teacher to this subject. `echoGuard`: on speakers the mic would hear the
  // teacher and cut it off, so the mic is closed while it talks and reopens by itself when it finishes;
  // tapping the orb breaks in.
  const live = useLiveTeacher({ subject, subjects, onSubject: noop, prefs, enrolledSubjects: subject.name, echoGuard: true });

  // Deferred a tick so a dev-time remount cancels it instead of opening two calls.
  const connectRef = useRef(live.connect);
  connectRef.current = live.connect;
  useEffect(() => {
    const t = window.setTimeout(() => void connectRef.current(opening), 0);
    return () => window.clearTimeout(t);
  }, [opening]);

  // The context message is plumbing; the student only sees their own words.
  const transcript = live.transcript.flatMap((item) => {
    if (item.kind !== "text" || item.role !== "user") return [item];
    const text = visibleStudentText(item.text);
    return text === null ? [] : [text === item.text ? item : { ...item, text }];
  });
  const view = deriveLectureView({
    status: live.status,
    speaking: live.speaking,
    muted: live.muted,
    micAvailable: live.micAvailable,
    micLevel: live.micLevel,
    teacherName: live.teacherName,
    transcript,
  });

  // The orb is animated per frame from refs, so it never forces a re-render. The teacher's output has no
  // level meter, so while it speaks the orb follows a syllable-like envelope.
  const micLevelRef = useRef(0);
  const speakingRef = useRef(false);
  micLevelRef.current = live.micLevel;
  speakingRef.current = live.speaking;
  const getLevel = useCallback(() => {
    if (!speakingRef.current) return micLevelRef.current;
    const t = performance.now() / 1000;
    const syllables = Math.abs(Math.sin(t * 9.1)) * 0.55 + Math.abs(Math.sin(t * 3.7 + 1.3)) * 0.3;
    return Math.min(1, 0.15 + syllables);
  }, []);

  const onOrbClick = () => {
    if (view.orbAction === "interrupt") live.interrupt();
    else if (view.orbAction === "mute") live.toggleMute();
    else if (view.orbAction === "restart") {
      live.reset();
      void live.connect(opening);
    }
  };

  // Typed text goes to the live call, or starts a new one that still carries the lecture context.
  const onSend = (text: string) => {
    if (live.status === "live") live.sendText(text);
    else {
      live.reset();
      void live.connect(withFirstQuestion(opening, text));
    }
  };

  return <LectureOrbScreen view={view} live={live} getLevel={getLevel} onOrbClick={onOrbClick} onSend={onSend} />;
}

function Gate({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <>
      <main className="aa-center">
        <div className="aa-gate">
          <span className="aa-mic-chip" aria-hidden="true">{icon}</span>
          <h2>{title}</h2>
          {text && <p>{text}</p>}
          {action && (
            <button type="button" className="aa-action" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      </main>
      <div />
    </>
  );
}
