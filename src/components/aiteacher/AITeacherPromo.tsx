import { Suspense, useCallback, useState } from "react";
import { useAITeacherSubscription } from "@/lib/aiTeacherSubscription";
import { aiTeacherDestination } from "@/lib/aiTeacherPromo";
import { openAskAI } from "@/lib/askAIStore";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { AITeacherFab } from "./AITeacherFab";
import { AITeacherShowcase } from "./AITeacherShowcase";

// The home page's AI Teacher marketing: the sample-lesson card (for students without a plan) and the glowing
// floating button (for everyone). Both lead the same way: with a plan, straight to the Ask AI screen (the one
// the lecture player opens), otherwise to the plans. The plans sheet is only loaded once someone asks for it.

const AITeacherPlanModal = lazyWithRetry(() =>
  import("./AITeacherPlanModal").then((m) => ({ default: m.AITeacherPlanModal })),
);

export function AITeacherPromo() {
  const { hasActivePlan, plans } = useAITeacherSubscription();
  const [plansRequested, setPlansRequested] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);

  const enter = useCallback(() => {
    if (aiTeacherDestination(hasActivePlan) === "teacher") {
      openAskAI();
      return;
    }
    setPlansRequested(true);
    setPlansOpen(true);
  }, [hasActivePlan]);

  return (
    <>
      {!hasActivePlan && <AITeacherShowcase price={plans.byok_500.price} onStart={enter} />}
      <AITeacherFab hasActivePlan={hasActivePlan} onClick={enter} />
      {plansRequested && (
        <Suspense fallback={null}>
          <AITeacherPlanModal open={plansOpen} onOpenChange={setPlansOpen} />
        </Suspense>
      )}
    </>
  );
}

export default AITeacherPromo;
