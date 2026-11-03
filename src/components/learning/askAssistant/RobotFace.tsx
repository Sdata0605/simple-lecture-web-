// The AI teacher as a small CSS robot. Pure presentation: the mode only changes its classes (listening,
// speaking, thinking, error); the animations live in ask-assistant.css and are turned off for reduced motion.
export type RobotMode = "idle" | "listening" | "speaking" | "thinking" | "error";

export interface RobotFaceProps {
  size: number;
  /** Smaller eyes and no antenna, for the top-bar button. */
  badge?: boolean;
  mode?: RobotMode;
}

export function RobotFace({ size, badge = false, mode = "idle" }: RobotFaceProps) {
  const classes = ["aa-robot", badge ? "is-badge" : "", mode !== "idle" ? `is-${mode}` : ""].filter(Boolean).join(" ");
  return (
    <span className={classes} style={{ width: size, height: size, fontSize: size }} aria-hidden="true">
      {!badge && <span className="aa-robot__antenna" />}
      <span className="aa-robot__head">
        <span className="aa-robot__screen">
          <span className="aa-robot__eyes">
            <span className="aa-robot__eye" />
            <span className="aa-robot__eye" />
          </span>
          <span className="aa-robot__smile" />
        </span>
      </span>
    </span>
  );
}
