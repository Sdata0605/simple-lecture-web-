// Hands-free voice assistant for asking a doubt about the current lecture.
// Flow: greet out loud → listen (no tap needed) → detect end of speech →
// send to Athena /ask → narrate progress with short voice cues → hand off to
// HyperframeAnswerPlayer → "anything else?" → listen again. Typing works at
// any point as an alternative to speaking.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Keyboard, Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { usePostLectureAthenaAnswer } from "@/hooks/usePostLectureAthenaAnswer";
import { HyperframeAnswerPlayer } from "../postLecture/HyperframeAnswerPlayer";
import { VoiceOrb, type VoiceOrbMode } from "./VoiceOrb";
import { useHandsFreeSpeech } from "./useHandsFreeSpeech";
import { useAssistantVoice } from "./useAssistantVoice";
import { cuesForAnswerProgress, type AnswerProgress } from "./statusCues";
import type { AssistantClipCategory } from "./assistantAudioTypes";
import "./ask-assistant.css";

type Stage =
  | "speaking" // assistant is talking (greeting / follow-up / didn't-catch…), mic opens after
  | "listening" // mic open, waiting for or hearing the student
  | "paused" // mic closed — typing, long silence, or mic unavailable; tap the orb to talk
  | "processing" // question sent, nothing streamed back yet
  | "answer" // HyperframeAnswerPlayer is showing the answer
  | "notice"; // out-of-scope / error line, then back to listening

const STILL_THINKING_AFTER_MS = [7000, 16000];

const MIC_PROBLEM_TEXT: Record<string, string> = {
  unsupported: "Voice input isn't available in this browser — type your question below.",
  "not-allowed": "Microphone access is blocked. Allow it in your browser settings, or type below.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser settings, or type below.",
  "audio-capture": "No microphone was found. You can type your question below.",
  network: "Voice recognition needs an internet connection. Type your question below.",
  noisy: "I'm having trouble hearing you clearly. Tap the orb to try again, or type below.",
};

export interface AskAIAssistantProps {
  /** "mid" = opened from the player's Ask AI button, "end" = lecture just finished. */
  trigger: "mid" | "end";
  onClose: () => void;
  subjectName?: string;
  athenaSubjectId: string;
  athenaChapterId?: string;
  athenaTopicId?: string;
  speechLang?: string;
}

export function AskAIAssistant({
  trigger,
  onClose,
  subjectName,
  athenaSubjectId,
  athenaChapterId,
  athenaTopicId,
  speechLang = "en-IN",
}: AskAIAssistantProps) {
  // Destructured so effects depend on the stable callbacks, not the hook's
  // per-render result object (which would re-run them on every render).
  const { say, interrupt, speaking, caption, getLevel: getVoiceLevel } = useAssistantVoice();
  const { state: answer, ask, reset } = usePostLectureAthenaAnswer();

  const [stage, setStage] = useState<Stage>("speaking");
  const [question, setQuestion] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [micProblem, setMicProblem] = useState<string | null>(null);

  const stageRef = useRef<Stage>(stage);
  const silenceStrikesRef = useRef(0);
  const unclearStrikesRef = useRef(0);
  const progressRef = useRef<AnswerProgress>({ phase: "idle", segmentCount: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const goTo = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  // Handlers the speech hook and voice-clip callbacks call later — kept in a
  // ref so those long-lived callbacks always reach the latest closures.
  const actions = useRef({
    submit: (_text: string) => {},
    startListening: () => {},
    didntCatch: () => {},
    noSpeech: () => {},
  });

  const speech = useHandsFreeSpeech({
    lang: speechLang,
    onUtterance: (text) => actions.current.submit(text),
    onUnclear: () => actions.current.didntCatch(),
    onNoSpeechTimeout: () => actions.current.noSpeech(),
  });

  // Speak a line, then open the mic — unless the student moved on meanwhile
  // (typed, closed, tapped the orb), in which case the stage no longer matches.
  const sayThenListen = useCallback(
    (category: AssistantClipCategory, fromStage: Stage) => {
      goTo(fromStage);
      say(category, () => {
        if (stageRef.current === fromStage) actions.current.startListening();
      });
    },
    [goTo, say],
  );

  actions.current.startListening = () => {
    // Never open the mic under a student who's mid-typing — a spoken word
    // would submit and wipe their draft.
    if (inputRef.current && document.activeElement === inputRef.current) {
      goTo("paused");
      return;
    }
    if (!speech.supported) {
      setMicProblem("unsupported");
      goTo("paused");
      return;
    }
    setMicProblem(null);
    goTo("listening");
    void speech.start();
  };

  actions.current.submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    speech.stop();
    interrupt();
    silenceStrikesRef.current = 0;
    unclearStrikesRef.current = 0;
    setQuestion(text);
    setTyped("");
    setNotice(null);
    goTo("processing");
    void ask({ question: text, subjectId: athenaSubjectId, chapterId: athenaChapterId, topicId: athenaTopicId });
  };

  // In a noisy room this could otherwise loop forever — stop asking after a
  // couple of tries and let the student tap or type.
  actions.current.didntCatch = () => {
    unclearStrikesRef.current += 1;
    if (unclearStrikesRef.current <= 2) {
      sayThenListen("didntCatch", "speaking");
    } else {
      unclearStrikesRef.current = 0;
      setMicProblem("noisy");
      goTo("paused");
    }
  };

  actions.current.noSpeech = () => {
    silenceStrikesRef.current += 1;
    if (silenceStrikesRef.current === 1) {
      sayThenListen("stillThere", "speaking");
    } else {
      goTo("paused");
    }
  };

  // Greet once on open.
  useEffect(() => {
    sayThenListen(trigger === "end" ? "greetingEnd" : "greeting", "speaking");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mic failed to start or died (permission, no device, network), or went
  // off without us stopping it (another feature took the voice lock). The
  // hook stops itself before every onUtterance/onUnclear/timeout callback,
  // but those move the stage off "listening" synchronously first, so only a
  // genuinely unexpected stop is caught here.
  const prevSpeechStatusRef = useRef(speech.status);
  useEffect(() => {
    const prev = prevSpeechStatusRef.current;
    prevSpeechStatusRef.current = speech.status;
    if (stageRef.current !== "listening") return;
    if (speech.status === "error") {
      setMicProblem(speech.error ?? "error");
      goTo("paused");
    } else if (speech.status === "off" && prev !== "off" && prev !== "error") {
      goTo("paused");
    }
  }, [speech.status, speech.error, goTo]);

  // Narrate the live answer progress with short voice cues.
  useEffect(() => {
    const next: AnswerProgress = { phase: answer.phase, segmentCount: answer.segments.length };
    const cues = cuesForAnswerProgress(progressRef.current, next);
    progressRef.current = next;

    for (const cue of cues) {
      if (cue === "interrupt") {
        interrupt();
      } else if ((cue === "outOfScope" || cue === "error") && stageRef.current === "processing") {
        setNotice(
          answer.errorMessage ||
            (cue === "outOfScope"
              ? "I couldn't find that in this subject's material. Try asking about this lecture."
              : "Something went wrong. Please try again."),
        );
        interrupt();
        sayThenListen(cue, "notice");
      } else {
        // Includes a late error while a partial answer is already on screen —
        // the answer player shows it; don't yank the student out of it.
        say(cue);
      }
    }

    if (stageRef.current === "processing") {
      if (next.segmentCount > 0 || next.phase === "video_ready") {
        // A video-only answer (no text segments) must still be shown.
        goTo("answer");
      } else if (next.phase === "text_only") {
        // Finished with nothing to show — don't leave the orb spinning forever.
        setNotice("I couldn't put together an answer for that. Try rephrasing your question?");
        interrupt();
        sayThenListen("error", "notice");
      }
      // awaiting_video with no text yet: keep the thinking orb until it's ready.
    }
  }, [answer.phase, answer.segments.length, answer.errorMessage, say, interrupt, sayThenListen, goTo]);

  // Taking a while with nothing streamed yet — reassure out loud.
  useEffect(() => {
    if (stage !== "processing") return;
    const timers = STILL_THINKING_AFTER_MS.map((ms) =>
      window.setTimeout(() => {
        if (stageRef.current === "processing") say("stillThinking");
      }, ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [stage, say]);

  // Closing mid-answer must stop the /ask stream and the video polling, which
  // otherwise keep running (polling for up to 5 minutes) after unmount.
  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stageRef.current !== "answer") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const backFromAnswer = () => {
    interrupt();
    reset();
    progressRef.current = { phase: "idle", segmentCount: 0 };
    setQuestion(null);
    sayThenListen("followUp", "speaking");
  };

  const onOrbClick = () => {
    const current = stageRef.current;
    if (current === "speaking" || current === "notice") {
      interrupt();
      actions.current.startListening();
    } else if (current === "listening") {
      speech.stop();
      goTo("paused");
    } else if (current === "paused") {
      actions.current.startListening();
    }
  };

  const onComposerFocus = () => {
    const current = stageRef.current;
    if (current === "listening" || current === "speaking" || current === "notice") {
      speech.stop();
      interrupt();
      goTo("paused");
    }
  };

  const onComposerSubmit = (event: FormEvent) => {
    event.preventDefault();
    actions.current.submit(typed);
  };

  const getSpeechLevel = speech.getLevel;
  const orbLevel = useCallback(
    () => (stageRef.current === "listening" ? getSpeechLevel() : getVoiceLevel()),
    [getSpeechLevel, getVoiceLevel],
  );

  if (stage === "answer") {
    return (
      <HyperframeAnswerPlayer
        answerId={answer.meta?.answer_id ?? null}
        phase={answer.phase}
        segments={answer.segments}
        video={answer.video}
        errorMessage={answer.errorMessage}
        questionText={question ?? ""}
        onClose={backFromAnswer}
      />
    );
  }

  const orbMode: VoiceOrbMode =
    stage === "processing"
      ? "thinking"
      : stage === "listening"
        ? "listening"
        : speaking
          ? "speaking"
          : stage === "notice"
            ? "error"
            : "idle";

  const hearing = stage === "listening" && speech.status === "hearing";
  const statusText =
    stage === "listening"
      ? hearing
        ? "Listening…"
        : "Go ahead, I'm listening"
      : stage === "processing"
        ? answer.phase === "streaming"
          ? "Searching your lecture material…"
          : "Thinking…"
        : stage === "paused"
          ? micProblem
            ? MIC_PROBLEM_TEXT[micProblem] ?? "Voice input stopped. Tap the orb to try again, or type below."
            : "Tap the orb to talk, or type below"
          : null;

  const liveTranscript = stage === "listening" ? speech.interimText : "";
  const assistantLine =
    (stage === "speaking" || stage === "notice" || stage === "processing") && speaking ? caption : null;

  const orbLabel =
    stage === "listening"
      ? "Stop listening"
      : stage === "paused"
        ? "Start talking"
        : stage === "speaking"
          ? "Skip and start talking"
          : "Assistant is thinking";

  return createPortal(
    <div className="aa-overlay" role="dialog" aria-modal="true" aria-label="Ask AI assistant">
      <header className="aa-topbar">
        <div className="aa-topbar__title">
          <Sparkles size={16} />
          <span>Ask AI</span>
          {subjectName && <span className="aa-topbar__subject">· {subjectName}</span>}
        </div>
        <button type="button" className="aa-icon-btn" onClick={onClose} aria-label="Close and return to the lecture">
          <X size={18} />
        </button>
      </header>

      <main className="aa-center">
        <div className="aa-orb-wrap">
          <VoiceOrb
            mode={orbMode}
            getLevel={orbLevel}
            onClick={stage === "processing" ? undefined : onOrbClick}
            ariaLabel={orbLabel}
          />
        </div>

        <div className="aa-text" aria-live="polite">
          {notice && stage !== "processing" && <p className="aa-notice">{notice}</p>}
          {question && stage === "processing" && (
            <p className="aa-question">
              <span>You asked</span>
              {question}
            </p>
          )}
          {statusText && (
            <p className={`aa-status${hearing ? " is-hearing" : ""}${micProblem && stage === "paused" ? " is-problem" : ""}`}>
              {statusText}
            </p>
          )}
          {liveTranscript && <p className="aa-transcript">{liveTranscript}</p>}
          {assistantLine && !liveTranscript && <p className="aa-caption">{assistantLine}</p>}
        </div>
      </main>

      <form className="aa-composer" onSubmit={onComposerSubmit}>
        <span className={`aa-mic-chip${stage === "listening" ? " is-live" : ""}`} aria-hidden="true">
          {stage === "listening" ? <Mic size={15} /> : micProblem ? <MicOff size={15} /> : <Keyboard size={15} />}
        </span>
        <input
          ref={inputRef}
          className="aa-input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onFocus={onComposerFocus}
          placeholder="Prefer typing? Ask your question here…"
          aria-label="Type your question"
          disabled={stage === "processing"}
          enterKeyHint="send"
        />
        <button
          type="submit"
          className="aa-send"
          disabled={!typed.trim() || stage === "processing"}
          aria-label="Send question"
        >
          <Send size={17} />
        </button>
      </form>
    </div>,
    document.body,
  );
}
