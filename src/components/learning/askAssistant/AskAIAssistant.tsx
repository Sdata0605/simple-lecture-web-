// "Ask AI" inside the lecture player: a full-screen lesson over the paused lecture. The student talks, by
// voice, to the same live AI Teacher as /aiteacher (Gemini Live: the teacher's own voice, answers grounded in
// the knowledge index), and the teacher is told which lecture is paused and where. It explains every question
// from the basics as steps on a lesson board next to the orb. There are no pre-recorded clips: every word the
// student hears is the teacher speaking.
import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Lock, Settings, Sparkles, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTeacherSettings, usePlanState } from "@/lib/aiTeacherKeys";
import { usePrefs } from "@/lib/aiTeacherPrefs";
import { teacherPlaybackRate } from "@/lib/aiTeacherVoice";
import { safeLocalStorage } from "@/lib/safeStorage";
import { silenceOtherAudio, voiceLock } from "@/lib/voiceLock";
import type { TeacherSubject } from "@/lib/aiTeacherApi";
import { focusReducer, type FocusEvent, type FocusState } from "@/lib/askPresentationFocus";
import {
  buildLectureOpening,
  deriveLectureView,
  deriveLesson,
  nextStepNudge,
  STUDENT_SPEAKING_LEVEL,
  visibleStudentText,
  withFirstQuestion,
  type LectureAskContext,
} from "@/lib/aiTeacherLecture";
import { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import { AITeacherSettingsPanel } from "@/components/aiteacher/AITeacherSettingsPanel";
import { LectureOrbScreen } from "./LectureOrbScreen";
import { SubjectPicker } from "./SubjectPicker";
import { RobotFace } from "./RobotFace";
import { useAutoContinue, useTurnSinceCard } from "./useAutoContinue";
import "./ask-assistant.css";

export interface AskAIAssistantProps {
  /**
   * "mid" = opened from the player's Ask AI button, "end" = lecture just finished, "ask" = opened from
   * anywhere else on the site (no lecture is paused).
   */
  trigger: "mid" | "end" | "ask";
  onClose: () => void;
  /** The subject to teach. When null the student picks one first (see `choices`). */
  subject: TeacherSubject | null;
  /** What the picker shows while `subject` is null. */
  choices?: {
    /** null while the list loads. */
    subjects: TeacherSubject[] | null;
    failed?: boolean;
    /** subject id -> names of the courses it belongs to. */
    courses?: Record<string, string[]>;
    unknown?: string | null;
    onRetry?: () => void;
  };
  topicTitle?: string | null;
  /** Language the lecture is playing in, e.g. "kannada". */
  lectureLanguage?: string | null;
  /** Where the lecture was paused (mid-lecture only). */
  context?: LectureAskContext | null;
}

const noop = () => {};

/** A nudge is held back until the student has been quiet this long. */
const STUDENT_PAUSE_MS = 1500;

export function AskAIAssistant(props: AskAIAssistantProps) {
  const { onClose, topicTitle, choices } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { data: settings, isFetching: keysLoading } = useTeacherSettings();
  const { state: planState, retry: retryPlan } = usePlanState();
  const [picked, setPicked] = useState<TeacherSubject | null>(null);
  // The gear opens the settings inside this overlay; back returns to the subject picker.
  const [view, setView] = useState<"teacher" | "settings">("teacher");
  // While a presentation is on screen the teacher panel can slide away; the robot in the top bar brings it back.
  const [focus, dispatchFocus] = useReducer(focusReducer, "lesson-full" as FocusState);
  const subject = props.subject ?? picked;
  const hasKeys = settings.keys.length > 0;

  // A new subject starts from the full lesson again.
  const subjectId = subject?.id ?? null;
  useEffect(() => {
    dispatchFocus("RESET");
  }, [subjectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape first folds the teacher panel away, and only a second press closes the overlay.
      if (focus === "presenting-with-panel") dispatchFocus("MINIMISE");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, focus]);

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
  } else if (view === "settings") {
    body = (
      <main className="aa-center aa-settings">
        <div className="aa-settings__inner">
          <AITeacherSettingsPanel onClose={() => setView("teacher")} />
        </div>
      </main>
    );
  } else if (planState === "loading") {
    body = <Gate icon={<Loader2 size={16} className="animate-spin" />} title="Checking your plan…" />;
  } else if (planState === "unknown") {
    body = (
      <Gate
        icon={<Lock size={16} />}
        title="Could not check your plan."
        action={{ label: "Retry", onClick: retryPlan }}
      />
    );
  } else if (planState === "inactive") {
    body = (
      <Gate
        icon={<Lock size={16} />}
        title="Buy AI Teacher Plus (Rs 500) to start"
        text="Plus lets you use your own free Google Gemini keys with your personal AI teacher."
        action={{
          label: "See the Plus plan",
          onClick: () =>
            navigate("/aiteacher/plus", {
              state: {
                returnTo: location.pathname + location.search,
                reopenAskAI: { subjectName: props.subject?.name },
              },
            }),
        }}
      />
    );
  } else if (keysLoading && !hasKeys) {
    body = <Gate icon={<Loader2 size={16} className="animate-spin" />} title="Getting your teacher ready…" />;
  } else if (!hasKeys) {
    body = (
      <Gate
        icon={<Lock size={16} />}
        title="Add your Gemini key to start"
        text="Your teacher uses your own free Google Gemini key. Save one in settings, then ask away."
        action={{ label: "Add your key", onClick: () => setView("settings") }}
      />
    );
  } else if (subject) {
    body = <LiveLecture {...props} subject={subject} focus={focus} dispatchFocus={dispatchFocus} />;
  } else {
    body = (
      <SubjectPicker
        subjects={choices?.subjects ?? null}
        failed={choices?.failed}
        courses={choices?.courses}
        unknown={choices?.unknown}
        onPick={setPicked}
        onRetry={choices?.onRetry}
      />
    );
  }

  return createPortal(
    <div className="aa-overlay" role="dialog" aria-modal="true" aria-label="Ask your AI teacher">
      <header className="aa-topbar">
        <div className="aa-topbar__title">
          <Sparkles size={16} />
          <span>Ask AI</span>
          {subject && view === "teacher" && (
            <span className="aa-topbar__subject">
              · {subject.name}
              {topicTitle ? ` · ${topicTitle}` : ""}
            </span>
          )}
        </div>
        {subject && view === "teacher" && focus !== "lesson-full" && (
          <button
            type="button"
            className="aa-topbar__robot"
            onClick={() => dispatchFocus("OPEN_PANEL")}
            aria-label="Show your teacher"
            title="Show your teacher"
          >
            <RobotFace size={40} badge />
          </button>
        )}
        <div className="aa-topbar__actions">
          {isAuthenticated && view === "teacher" && (
            <button
              type="button"
              className="aa-icon-btn"
              onClick={() => setView("settings")}
              aria-label="Teacher settings: your Gemini keys, voice and teacher style"
              title="Teacher settings"
            >
              <Settings size={17} />
            </button>
          )}
          <button type="button" className="aa-icon-btn" onClick={onClose} aria-label="Close and return to the lecture">
            <X size={18} />
          </button>
        </div>
      </header>
      {body}
    </div>,
    document.body,
  );
}

/** Starts the live call as soon as it opens and shows the teacher on the orb screen. */
function LiveLecture({
  trigger,
  subject,
  topicTitle,
  lectureLanguage,
  context,
  focus,
  dispatchFocus,
}: AskAIAssistantProps & { subject: TeacherSubject; focus: FocusState; dispatchFocus: Dispatch<FocusEvent> }) {
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
  // tapping the orb breaks in. `keepGoing`: a lesson explains in steps and carries straight on to the next
  // one, instead of the teacher ending its turn after each and waiting to be told to continue. `sessionMode`
  // makes the teacher offer practice questions rather than ask them, and `playbackRate` slows its voice a little.
  const live = useLiveTeacher({
    subject,
    subjects,
    onSubject: noop,
    prefs,
    enrolledSubjects: subject.name,
    echoGuard: true,
    keepGoing: true,
    sessionMode: "ask",
    playbackRate: teacherPlaybackRate(safeLocalStorage.getItem("aiteacher.rate")),
  });

  // One voice at a time: take the voice lock (the old AI assistant and the sales assistant stop talking) and
  // pause any lecture or audio still playing behind this screen, which otherwise sounds like a second teacher.
  useEffect(() => {
    voiceLock.acquire("askAssistant");
    silenceOtherAudio();
    return () => voiceLock.release("askAssistant");
  }, []);

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
  const lesson = deriveLesson(transcript);

  // The orb is animated per frame from refs, so it never forces a re-render. The teacher's output has no
  // level meter, so while it speaks the orb follows a syllable-like envelope.
  const micLevelRef = useRef(0);
  const speakingRef = useRef(false);
  micLevelRef.current = live.micLevel;
  speakingRef.current = live.speaking;
  // When the student was last clearly heard. A nudge waits for a real pause after that: the server decides
  // the student has finished only after a short silence, and a message sent inside that silence cuts them off.
  const lastVoiceAtRef = useRef(0);
  if (live.micLevel >= STUDENT_SPEAKING_LEVEL) lastVoiceAtRef.current = performance.now();
  const liveRef = useRef(live);
  liveRef.current = live;

  // Backstop for the lesson flow: if the teacher still ends its turn after a step, and the student has said
  // nothing, tell it (silently) to go on, so nobody has to say "go ahead". It waits while the teacher or the
  // student is talking.
  const lastCardId = lesson.cards.length ? lesson.cards[lesson.cards.length - 1].id : null;
  const turnDone = useTurnSinceCard(live.turnsCompleted, lastCardId);
  const nudge = nextStepNudge({ inCall: live.status === "live", speaking: live.speaking, turnDone, transcript });
  // A nudge never cuts the teacher off (bargeIn: false) and waits while the teacher is mid-turn or the student
  // has just spoken.
  useAutoContinue(nudge, (text) => live.sendText(text, { silent: true, bargeIn: false }), {
    isStudentSpeaking: () =>
      micLevelRef.current >= STUDENT_SPEAKING_LEVEL ||
      performance.now() - lastVoiceAtRef.current < STUDENT_PAUSE_MS ||
      liveRef.current.isTeacherBusy(),
    turnsCompleted: live.turnsCompleted,
  });
  const getLevel = useCallback(() => {
    if (!speakingRef.current) return micLevelRef.current;
    const t = performance.now() / 1000;
    const syllables = Math.abs(Math.sin(t * 9.1)) * 0.55 + Math.abs(Math.sin(t * 3.7 + 1.3)) * 0.3;
    return Math.min(1, 0.15 + syllables);
  }, []);

  const onOrbClick = () => {
    console.log("[AskAI] orb tapped", { orbAction: view.orbAction, status: live.status, speaking: live.speaking, micAvailable: live.micAvailable, muted: live.muted });
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

  // Quick buttons ("Explain simpler"...) are requests to the teacher, not questions: they stay off the board.
  const onQuick = (prompt: string) => {
    if (live.status === "live") live.sendText(prompt, { silent: true });
  };

  return (
    <LectureOrbScreen
      view={view}
      lesson={lesson}
      live={live}
      getLevel={getLevel}
      onOrbClick={onOrbClick}
      onSend={onSend}
      onQuick={onQuick}
      focus={focus}
      dispatchFocus={dispatchFocus}
    />
  );
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
  );
}
