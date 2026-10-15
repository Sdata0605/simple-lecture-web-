import { useEffect, useState } from "react";
import { VoiceOrb } from "@/components/learning/askAssistant/VoiceOrb";
import { safeSessionStorage } from "@/lib/safeStorage";
import "./ai-teacher-promo.css";

// The glowing AI button that floats over the home page. It carries the same orb as the Ask AI screen, so the
// student recognises it when they get there. It only reports the click: the promo decides whether that opens the
// AI Teacher (student has a plan) or the plans (they don't).

const LABEL_SEEN_KEY = "aiteacher.fab.label.seen";
const LABEL_DELAY_MS = 1500;
const LABEL_SHOWN_MS = 6000;

interface AITeacherFabProps {
  hasActivePlan: boolean;
  onClick: () => void;
}

export function AITeacherFab({ hasActivePlan, onClick }: AITeacherFabProps) {
  const [labelVisible, setLabelVisible] = useState(false);

  // The label introduces the button once per visit, then gets out of the way (it also shows on hover).
  useEffect(() => {
    if (safeSessionStorage.getItem(LABEL_SEEN_KEY) === "1") return;
    const show = window.setTimeout(() => setLabelVisible(true), LABEL_DELAY_MS);
    const hide = window.setTimeout(() => {
      setLabelVisible(false);
      safeSessionStorage.setItem(LABEL_SEEN_KEY, "1");
    }, LABEL_DELAY_MS + LABEL_SHOWN_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  return (
    <div className="atp-fab">
      <span className="atp-fab__label" data-visible={labelVisible} aria-hidden="true">
        {hasActivePlan ? "Ask AI Teacher" : "Meet your AI Teacher"}
      </span>
      <div className="atp-fab__bob">
        <button
          type="button"
          className="atp-fab__button"
          onClick={onClick}
          aria-label={hasActivePlan ? "Open AI Teacher" : "See AI Teacher plans"}
        >
          <span className="atp-fab__ring" aria-hidden="true" />
          <span className="atp-fab__orb">
            <VoiceOrb mode="idle" size={76} />
          </span>
          <span className="atp-fab__ai" aria-hidden="true">
            AI
          </span>
        </button>
      </div>
    </div>
  );
}

export default AITeacherFab;
