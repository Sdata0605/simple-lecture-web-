// The Ask AI screen of the lecture player. Everything the student hears is the live AI Teacher's own voice;
// this component only shows what is happening.
//   - Laptops and tablets: the lesson board on the left (the question, then the explanation as steps, from
//     the basics to the answer and a question to solve) and the teacher on the right (robot, captions, quick
//     buttons, type box). Once a presentation is on screen the teacher slides away and a robot in the top bar
//     brings it back.
//   - Phones: one step at a time with the teacher docked underneath; the teacher becomes a bottom sheet.
// It is the content of the `.aa-overlay` grid below the top bar.
import { useEffect, useRef, useState, type Dispatch, type FormEvent } from "react";
import { ImagePlus, Keyboard, Loader2, Mic, MicOff, Send, X } from "lucide-react";
import { QUICK_REQUESTS, type Lesson, type LectureView } from "@/lib/aiTeacherLecture";
import { prepareQuestionImage, QuestionImageError } from "@/lib/aiTeacherImage";
import type { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import type { FocusEvent, FocusState } from "@/lib/askPresentationFocus";
import { LessonBoard } from "./LessonBoard";
import type { CardActions } from "./LessonCards";
import { RobotFace } from "./RobotFace";
import "./ask-assistant.css";
import "./lesson-board.css";

type Live = ReturnType<typeof useLiveTeacher>;

export interface LectureOrbScreenProps {
  view: LectureView;
  lesson: Lesson;
  /** Only what the screen reads from the live teacher. */
  live: Pick<Live, "error" | "notice" | "muted" | "micAvailable"> & CardActions;
  /** Read every animation frame by the orb: 0..1. */
  getLevel: () => number;
  onOrbClick: () => void;
  onSend: (text: string) => void;
  /** A photo of a question (JPEG data URL) with an optional typed note. */
  onSendPhoto?: (image: string, text: string) => void;
  /** A quick button: the prompt goes to the teacher without showing up as the student's question. */
  onQuick: (prompt: string) => void;
  /** Whether a presentation is on screen and whether the teacher panel is open over it. */
  focus: FocusState;
  dispatchFocus: Dispatch<FocusEvent>;
}

export function LectureOrbScreen({ view, lesson, live, onOrbClick, onSend, onSendPhoto, onQuick, focus, dispatchFocus }: LectureOrbScreenProps) {
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [typed, setTyped] = useState("");
  const hasBoard = lesson.cards.length > 0;

  // A presentation starts when the first card arrives and ends when the lesson board is cleared.
  useEffect(() => {
    dispatchFocus(hasBoard ? "PRESENTATION_START" : "PRESENTATION_END");
  }, [hasBoard, dispatchFocus]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!view.canType || photoBusy) return;
    if (pendingImage && onSendPhoto) {
      const image = pendingImage;
      setPendingImage(null);
      setPhotoNote("");
      setTyped("");
      onSendPhoto(image, text);
      return;
    }
    if (!text) return;
    setTyped("");
    onSend(text);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoNote("");
    setPhotoBusy(true);
    try {
      setPendingImage(await prepareQuestionImage(file));
    } catch (e) {
      setPendingImage(null);
      setPhotoNote(e instanceof QuestionImageError ? e.message : "The photo could not be read. Please try another picture.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";   // so the same photo can be picked again
    }
  };

  const micLive = view.orbMode === "listening";
  const presenting = focus !== "lesson-full";
  const panelOpen = focus === "presenting-with-panel";

  const stageClass = ["aa-stage", hasBoard ? "has-board" : "", presenting ? "is-presenting" : "", panelOpen ? "is-panel-open" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={stageClass}>
      <section className="aa-board" aria-label="Lesson board">
        <LessonBoard lesson={lesson} actions={live} />
      </section>

      <div
        className="scrim"
        aria-hidden="true"
        onClick={() => {
          if (focus === "presenting-with-panel") dispatchFocus("MINIMISE");
        }}
      />

      <aside className="aa-teacher" aria-label="Your teacher">
        {hasBoard && (
          <button
            type="button"
            className="aa-minimise"
            onClick={() => dispatchFocus("MINIMISE")}
            aria-label="Minimise teacher panel"
          >
            Minimise
          </button>
        )}

        <div className="aa-orb-wrap">
          <button
            type="button"
            className="aa-robot-btn"
            onClick={view.orbAction === "none" ? undefined : onOrbClick}
            aria-label={view.orbLabel}
          >
            <RobotFace size={140} mode={view.orbMode} />
          </button>
        </div>

        <div className="aa-text" aria-live="polite">
          {(live.error || live.notice) && <p className="aa-notice">{live.error || live.notice}</p>}
          {view.status && <p className={`aa-status${view.statusTone === "hearing" ? " is-hearing" : ""}`}>{view.status}</p>}
          {view.studentLine?.live && <p className="aa-transcript">{view.studentLine.text}</p>}
          {/* Once the board is up, the question sits at the top of it instead. */}
          {view.studentLine && !view.studentLine.live && !hasBoard && (
            <p className="aa-question">
              <span>You asked</span>
              {view.studentLine.text}
            </p>
          )}
          {view.teacherCaption && <p className="aa-caption">{view.teacherCaption}</p>}
        </div>

        {view.inCall && (
          <div className="aa-chips" role="group" aria-label="Quick requests">
            {QUICK_REQUESTS.map((request) => (
              <button key={request.id} type="button" className="aa-chip" onClick={() => onQuick(request.prompt)}>
                {request.label}
              </button>
            ))}
          </div>
        )}

        {(pendingImage || photoNote) && (
          <div className="aa-photo-row">
            {pendingImage && (
              <div className="aa-photo-thumb">
                <img src={pendingImage} alt="Photo ready to send" />
                <button type="button" className="aa-photo-remove" onClick={() => setPendingImage(null)} aria-label="Remove photo">
                  <X size={12} />
                </button>
              </div>
            )}
            <p className={`aa-photo-note${photoNote ? " is-error" : ""}`} role={photoNote ? "alert" : undefined}>
              {photoNote || "Photo added. Add a note if you like, then send. Your teacher will read it and explain the solution."}
            </p>
          </div>
        )}

        <form className="aa-composer" onSubmit={submit}>
          <span className={`aa-mic-chip${micLive ? " is-live" : ""}`} aria-hidden="true">
            {micLive ? <Mic size={15} /> : !live.micAvailable || live.muted ? <MicOff size={15} /> : <Keyboard size={15} />}
          </span>
          {onSendPhoto && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="aa-file-input"
                onChange={(event) => void pickPhoto(event.target.files?.[0])}
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                className="aa-photo-btn"
                onClick={() => fileRef.current?.click()}
                disabled={!view.canType || photoBusy}
                aria-label="Upload a photo of your question"
                title="Upload a photo of your question"
              >
                {photoBusy ? <Loader2 size={16} className="aa-spin" /> : <ImagePlus size={16} />}
              </button>
            </>
          )}
          <input
            className="aa-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={pendingImage ? "Add a note about the photo (optional)…" : "Prefer typing? Ask your question here…"}
            aria-label="Type your question"
            disabled={!view.canType}
            maxLength={500}
            enterKeyHint="send"
          />
          <button type="submit" className="aa-send" disabled={(!typed.trim() && !pendingImage) || !view.canType || photoBusy} aria-label="Send question">
            <Send size={17} />
          </button>
        </form>
      </aside>
    </main>
  );
}
