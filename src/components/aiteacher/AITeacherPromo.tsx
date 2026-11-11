import { openAskAI } from "@/lib/askAIStore";
import { AITeacherFab } from "./AITeacherFab";
import { AITeacherShowcase } from "./AITeacherShowcase";

// The home page's AI Teacher marketing: the sample-lesson card and the glowing floating button. Both open the
// Ask AI overlay (the one the lecture player opens) through openAskAI().

export function AITeacherPromo() {
  const enter = () => openAskAI();

  return (
    <>
      <AITeacherShowcase onStart={enter} />
      <AITeacherFab onClick={enter} />
    </>
  );
}

export default AITeacherPromo;
