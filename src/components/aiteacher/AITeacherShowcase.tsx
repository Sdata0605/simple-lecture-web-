import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, Calculator, HelpCircle, Layers, Mic, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceOrb, type VoiceOrbMode } from "@/components/learning/askAssistant/VoiceOrb";
import {
  DEMO_START,
  DEMO_TICK_MS,
  PROMO_BADGE,
  PROMO_CTA,
  PROMO_DEMOS,
  PROMO_FEATURES,
  PROMO_FOOTNOTE,
  PROMO_SUBTITLE,
  PROMO_TITLE,
  advanceDemo,
  demoPhase,
  finishedDemo,
  startDemo,
  type DemoPhase,
  type DemoState,
  type PromoIcon,
} from "@/lib/aiTeacherPromo";
import "./ai-teacher-promo.css";

// The home page's pitch for the AI Teacher, shown to students without a plan: a sample lesson that plays by itself
// (a question, then the teacher explaining step by step, with the same orb as the Ask AI screen), what they get,
// and one button to the plans.

const ICONS: Record<PromoIcon, LucideIcon> = { mic: Mic, steps: Layers, maths: Calculator, quiz: HelpCircle };

const ORB_MODE: Record<DemoPhase, VoiceOrbMode> = { asking: "listening", explaining: "speaking", done: "idle" };

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

/** Plays the sample lessons in turn — only while the card is on screen, and shown complete to anyone who wants less motion. */
function usePromoDemo(stageRef: RefObject<HTMLElement>) {
  const reduceMotion = usePrefersReducedMotion();
  const [state, setState] = useState<DemoState>(DEMO_START);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageRef]);

  useEffect(() => {
    if (!onScreen || reduceMotion) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setState((s) => advanceDemo(s));
    }, DEMO_TICK_MS);
    return () => window.clearInterval(id);
  }, [onScreen, reduceMotion]);

  const choose = useCallback(
    (index: number) => setState(reduceMotion ? finishedDemo(index) : startDemo(index)),
    [reduceMotion],
  );

  return { state: reduceMotion ? finishedDemo(state.demo) : state, choose, reduceMotion };
}

function StepLine({ step }: { step: string }) {
  const [label, ...rest] = step.split(" · ");
  return (
    <p className="atp-step text-sm md:text-base leading-relaxed text-[#eef6f4]">
      <span className="font-bold text-[#7ce0c3]">{label}</span>
      {rest.length > 0 && <> · {rest.join(" · ")}</>}
    </p>
  );
}

interface AITeacherShowcaseProps {
  /** The lowest plan price, shown as "From ₹…". */
  price: number;
  /** Opens the plans. */
  onStart: () => void;
}

export function AITeacherShowcase({ price, onStart }: AITeacherShowcaseProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const { state, choose, reduceMotion } = usePromoDemo(stageRef);
  const demo = PROMO_DEMOS[state.demo] ?? PROMO_DEMOS[0];
  const phase = demoPhase(state);

  // The orb "hears" the question and "speaks" the steps: its level follows a made-up voice while one of those is going on.
  const phaseRef = useRef<DemoPhase>(phase);
  phaseRef.current = phase;
  const motionRef = useRef(reduceMotion);
  motionRef.current = reduceMotion;
  const getLevel = useCallback(() => {
    if (motionRef.current || phaseRef.current === "done") return 0;
    return 0.3 + 0.35 * Math.abs(Math.sin(performance.now() / 170));
  }, []);

  const [firstSentence, ...restOfTitle] = PROMO_TITLE.split(". ");

  return (
    <section
      id="ai-teacher-promo"
      aria-labelledby="ai-teacher-promo-title"
      className="relative overflow-hidden bg-[#050d0c] py-12 text-[#eef6f4] md:py-20"
    >
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#7ce0c3]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-[#818cf8]/10 blur-3xl" />

      <div className="container relative mx-auto px-4">
        {/* One column on a phone (pitch, the sample lesson, the button, then the details); two on a desktop. */}
        <div className="grid items-start gap-x-14 gap-y-8 lg:grid-cols-[1.05fr_1fr]">
          <div className="lg:col-start-1 lg:row-start-1">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f5c66a]/30 bg-[#f5c66a]/10 px-3 py-1">
              <Sparkles className="h-3.5 w-3.5 text-[#f5c66a]" />
              <span className="text-[11px] font-extrabold tracking-wider text-[#f5c66a]">{PROMO_BADGE}</span>
            </div>

            <h2 id="ai-teacher-promo-title" className="text-3xl font-extrabold leading-tight md:text-4xl lg:text-5xl">
              {firstSentence}. <span className="text-[#7ce0c3]">{restOfTitle.join(". ")}</span>
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[#91a7a3] md:text-lg">{PROMO_SUBTITLE}</p>
          </div>

          <div
            ref={stageRef}
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 md:p-7 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-center"
          >
            <div className="border-b border-white/10 pb-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold tracking-widest text-[#91a7a3]">
                <Mic className="h-3 w-3 text-[#7ce0c3]" />
                YOU ASKED · {demo.subject.toUpperCase()}
              </p>
              <p className="text-lg font-semibold leading-snug md:text-xl">“{demo.ask}”</p>
            </div>

            <div className="flex min-h-[170px] items-center gap-3 pt-4 md:gap-5">
              <div className="shrink-0">
                <VoiceOrb mode={ORB_MODE[phase]} getLevel={getLevel} size={130} ariaLabel="AI Teacher" />
              </div>
              <div className="min-w-0 flex-1 space-y-2.5" aria-live="polite">
                {state.shown === 0 && <p className="text-sm italic text-[#91a7a3]">Listening…</p>}
                {demo.steps.slice(0, state.shown).map((step, i) => (
                  <StepLine key={`${demo.id}-${i}`} step={step} />
                ))}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {PROMO_DEMOS.map((d, i) => {
                const active = i === state.demo;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => choose(i)}
                    aria-pressed={active}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
                      active
                        ? "border-[#7ce0c3] bg-[#7ce0c3]/15 text-[#7ce0c3]"
                        : "border-white/15 text-[#91a7a3] hover:border-white/30 hover:text-[#eef6f4]"
                    }`}
                  >
                    {d.subject}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-[11px] text-[#91a7a3]">{PROMO_FOOTNOTE}</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:col-start-1 lg:row-start-3">
            <Button
              size="lg"
              onClick={onStart}
              className="h-auto rounded-xl bg-gradient-to-r from-[#7ce0c3] to-[#5eead4] px-6 py-4 text-base font-bold text-[#062019] shadow-lg shadow-[#7ce0c3]/20 hover:brightness-105"
            >
              {PROMO_CTA}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <span className="text-sm font-semibold text-[#7ce0c3]">Plans from ₹{price}</span>
          </div>

          <ul className="grid grid-cols-2 gap-3 lg:col-start-1 lg:row-start-2">
            {PROMO_FEATURES.map((feature) => {
              const Icon = ICONS[feature.icon];
              return (
                <li key={feature.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 md:p-4">
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#7ce0c3]/10">
                    <Icon className="h-4 w-4 text-[#7ce0c3]" />
                  </span>
                  <p className="text-sm font-extrabold">{feature.title}</p>
                  <p className="mt-0.5 hidden text-xs leading-relaxed text-[#91a7a3] sm:block">{feature.body}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default AITeacherShowcase;
