import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  KeyRound,
  MessageSquareText,
  Mic,
  Settings as SettingsIcon,
  Sparkles,
  X,
  Lock,
  LogIn,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  ArrowLeft,
  ShieldCheck,
  Zap,
  HelpCircle,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { teacherApi, type TeacherSubject } from "@/lib/aiTeacherApi";
import { VoiceMode } from "@/components/aiteacher/VoiceMode";
import { ChatMode } from "@/components/aiteacher/ChatMode";
import { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import { usePrefs } from "@/lib/aiTeacherPrefs";
import { useAITeacherSubscription, AI_TEACHER_PLANS, type AITeacherPlanId } from "@/lib/aiTeacherSubscription";
import { AITeacherPlanModal } from "@/components/aiteacher/AITeacherPlanModal";
import { AITeacherGuideModal } from "@/components/aiteacher/AITeacherGuideModal";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type Mode = "voice" | "chat";

function ModeButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Mic; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none",
        active ? "bg-emerald-700 text-white shadow" : "text-muted-foreground hover:bg-accent",
      )}
    >
      <Icon className="h-4 w-4" />{label}
    </button>
  );
}

function useVisualViewport() {
  const read = () => {
    const vv = window.visualViewport;
    return { height: vv?.height ?? window.innerHeight, top: vv?.offsetTop ?? 0 };
  };
  const [box, setBox] = useState(read);
  useEffect(() => {
    const update = () => setBox(read());
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return box;
}

/**
 * Access gate screen shown to visitors who are not logged in.
 * Strict requirement: "with outhloging no body can see or use this page"
 */
function AITeacherLoginRequired() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background flex flex-col">
      <header className="border-b bg-background/90 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-emerald-800">
            <GraduationCap className="h-6 w-6" />
            <span>SimpleLecture</span>
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border bg-card/95 shadow-xl p-6 sm:p-8 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 shadow-inner">
            <Lock className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100/80 text-emerald-800">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              1-to-1 Personal AI Teacher
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Login Required
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Personal 1-to-1 AI Tutoring is an exclusive feature for SimpleLecture students. Please sign in to your account to access your personal AI teacher.
            </p>
          </div>

          <div className="rounded-xl border bg-muted/40 p-3.5 text-left space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>1-to-1 interactive voice and chat lessons</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Instant doubt solving in English and Kannada</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Personalized tutoring for your enrolled courses</span>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <Button asChild size="lg" className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold shadow-md">
              <Link to="/auth?tab=login&redirect=/aiteacher">
                <LogIn className="h-4 w-4 mr-2" />
                Log In / Sign Up to Continue
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/">Explore SimpleLecture Courses</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Paywall screen shown when user is logged in but hasn't purchased an AI Teacher plan.
 * Strict requirement: "make sure if any user dont purchase this plans then he should not use this servive or feture"
 */
function AITeacherPaywall({
  onSelectPlan,
  isVerifying,
  onRefresh,
  onOpenGuide,
}: {
  onSelectPlan: (planId: AITeacherPlanId) => void;
  isVerifying: boolean;
  onRefresh: () => void;
  onOpenGuide: (tab?: "how-to-use" | "api-key") => void;
}) {
  const { plans } = useAITeacherSubscription();

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background flex flex-col">
      <header className="border-b bg-background/90 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold text-emerald-800">
            <GraduationCap className="h-6 w-6" />
            <span>SimpleLecture</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenGuide("how-to-use")}
              className="gap-1.5 border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-medium"
            >
              <HelpCircle className="h-4 w-4 text-emerald-600" />
              <span className="hidden sm:inline">How to Use & Set Key</span>
              <span className="sm:hidden">Help Guide</span>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-8 space-y-8">
        {/* Paywall Header */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            Personal 1-to-1 AI Tutoring
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Unlock Your Personal AI Teacher
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            Experience personalized 1-to-1 voice and chat tutoring tailored for your enrolled courses. Practice concepts, ask unlimited doubts, and master any topic at your own pace.
          </p>
        </div>

        {/* 2 Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto items-stretch">
          {/* Plan 1: Plus Plan */}
          <div className="rounded-2xl border-2 border-border/80 bg-card p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-all">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {plans.byok_500.badge || "Budget Friendly"}
                </span>
                <span className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700">
                  <KeyRound className="h-5 w-5" />
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-foreground">{plans.byok_500.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {plans.byok_500.tagline}
                </p>
              </div>

              <div className="pt-2">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold text-foreground">₹{plans.byok_500.price?.toLocaleString("en-IN")}</span>
                  <span className="text-xs text-muted-foreground font-medium">one-time access</span>
                </div>
              </div>

              <div className="space-y-2.5 pt-4 border-t text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>1-to-1 Interactive AI Voice Teacher</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Interactive 24/7 AI Chat with notes & visual slides</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Unlimited practice questions & doubt clearing</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Works with all your enrolled subjects</span>
                </div>
                <div className="flex items-start gap-2 text-foreground font-medium">
                  <KeyRound className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>Requires your personal Gemini API key (Free to obtain)</span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenGuide("api-key")}
                  className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                >
                  <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
                  <span>How to create & set free API key? →</span>
                </button>
              </div>
            </div>

            <div className="pt-6">
              <Button
                size="lg"
                variant="outline"
                className="w-full border-2 border-primary/40 hover:border-primary font-bold shadow-sm"
                onClick={() => onSelectPlan("byok_500")}
              >
                Choose Plus Plan - ₹{plans.byok_500.price?.toLocaleString("en-IN")}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>

          {/* Plan 2: Pro Managed Plan */}
          <div className="relative rounded-2xl border-2 border-emerald-500 bg-gradient-to-b from-emerald-50/50 to-card dark:from-emerald-950/20 p-6 flex flex-col justify-between shadow-lg ring-1 ring-emerald-500/20">
            <div className="absolute -top-3 right-6 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-md uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Most Popular · Zero Setup
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Admin Powered
                </span>
                <span className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700">
                  <Zap className="h-5 w-5" />
                </span>
              </div>

              <div>
                <h3 className="text-xl font-bold text-foreground">{plans.admin_1000.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {plans.admin_1000.tagline}
                </p>
              </div>

              <div className="pt-2">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold text-emerald-700 dark:text-emerald-400">₹{plans.admin_1000.price?.toLocaleString("en-IN")}</span>
                  <span className="text-xs text-muted-foreground font-medium">one-time access</span>
                </div>
              </div>

              <div className="space-y-2.5 pt-4 border-t text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-foreground">Works on SimpleLecture Admin's Managed Gemini API Key</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-foreground">Zero setup required — start learning in 1 click!</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>1-to-1 Interactive AI Voice Teacher with low latency</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Interactive 24/7 AI Chat with notes & visual slides</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Priority server speed and dedicated tutor support</span>
                </div>
              </div>
            </div>

            <div className="pt-6">
              <Button
                size="lg"
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold shadow-md"
                onClick={() => onSelectPlan("admin_1000")}
              >
                <Sparkles className="h-4 w-4 mr-1.5" />
                Unlock Pro Plan - ₹{plans.admin_1000.price?.toLocaleString("en-IN")}
              </Button>
            </div>
          </div>
        </div>

        {/* Quick Guide Options */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenGuide("how-to-use")}
            className="gap-2 rounded-full border-emerald-300 bg-card text-emerald-800 hover:bg-emerald-50 shadow-sm text-xs font-semibold"
          >
            <BookOpen className="h-4 w-4 text-emerald-600" />
            <span>How to Use AI Teacher Guide</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenGuide("api-key")}
            className="gap-2 rounded-full border-amber-300 bg-card text-amber-800 hover:bg-amber-50 shadow-sm text-xs font-semibold"
          >
            <KeyRound className="h-4 w-4 text-amber-600" />
            <span>How to Create & Set API Key</span>
          </Button>
        </div>

        {/* Verification / Refresh */}
        <div className="text-center pt-2 space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Secured by Razorpay · 100% Safe Payment · Instant Activation</span>
          </div>

          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
              disabled={isVerifying}
              onClick={onRefresh}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isVerifying && "animate-spin")} />
              {isVerifying ? "Verifying Subscription..." : "Already purchased? Click to verify payment status"}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Full interactive 1-to-1 AI Teacher session.
 * Rendered ONLY when the user is logged in AND has an active purchased plan.
 */
function AITeacherActive() {
  const [searchParams] = useSearchParams();
  const [subject, setSubject] = useState<TeacherSubject | null>(null);
  const [mode, setMode] = useState<Mode>("voice");
  const viewport = useVisualViewport();
  const [prefs, updatePrefs] = usePrefs();
  const { isPlan500, isPlan1000 } = useAITeacherSubscription();
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<"how-to-use" | "api-key">("how-to-use");
  const [quickKey, setQuickKey] = useState("");
  const [savedKeySuccess, setSavedKeySuccess] = useState(false);

  useEffect(() => { document.title = "AI Teacher 1-to-1 | SimpleLecture"; }, []);

  // Prevent outer page scrolling
  useEffect(() => {
    const html = document.documentElement;
    const prev = { htmlOverflow: html.style.overflow, bodyOverflow: document.body.style.overflow, overscroll: html.style.overscrollBehavior };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      document.body.style.overflow = prev.bodyOverflow;
      html.style.overscrollBehavior = prev.overscroll;
    };
  }, []);

  const { user } = useAuth();

  const subjectsQ = useQuery({
    queryKey: ["ai-teacher", "subjects"],
    queryFn: async () => (await teacherApi<{ subjects: TeacherSubject[] }>("subjects")).subjects,
    staleTime: 5 * 60_000,
  });
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data]);

  // Fetch student's enrolled courses to enforce syllabus boundary
  const enrolledSubjectsQ = useQuery({
    queryKey: ["student-enrolled-subjects", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data: enrollments } = await supabase
        .from("enrollments")
        .select(`
          course_id,
          courses (
            id, name,
            course_subjects (
              popular_subjects (id, name)
            )
          )
        `)
        .eq("student_id", user.id)
        .eq("is_active", true);

      if (!enrollments || enrollments.length === 0) return [];
      const list = new Set<string>();
      for (const e of enrollments) {
        const c: any = e.courses;
        if (c?.course_subjects) {
          for (const cs of c.course_subjects) {
            const ps = Array.isArray(cs.popular_subjects) ? cs.popular_subjects[0] : cs.popular_subjects;
            if (ps?.name) list.add(ps.name.trim());
          }
        }
      }
      return [...list];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const enrolledSubjectNames = enrolledSubjectsQ.data ?? [];

  // Scoped subjects based on enrolled courses
  const availableSubjects = useMemo(() => {
    if (!enrolledSubjectNames || enrolledSubjectNames.length === 0) return subjects;
    const names = enrolledSubjectNames.map((n) => n.toLowerCase().trim());
    const matched = subjects.filter((s) =>
      names.some((n) => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase()))
    );
    return matched.length > 0 ? matched : subjects;
  }, [subjects, enrolledSubjectNames]);

  const enrolledSubjectsText = useMemo(() => {
    if (enrolledSubjectNames.length > 0) return enrolledSubjectNames.join(", ");
    return availableSubjects.map((s) => s.name).join(", ");
  }, [enrolledSubjectNames, availableSubjects]);

  // Set initial subject if passed in URL e.g. /aiteacher?subject=Mathematics
  useEffect(() => {
    const urlSubject = searchParams.get("subject");
    if (urlSubject && availableSubjects.length > 0 && !subject) {
      const match = availableSubjects.find(
        (s) => s.name.toLowerCase() === urlSubject.toLowerCase() || s.id.toLowerCase() === urlSubject.toLowerCase()
      );
      if (match) setSubject(match);
    }
  }, [searchParams, availableSubjects, subject]);

  const live = useLiveTeacher({
    subject,
    subjects: availableSubjects,
    onSubject: setSubject,
    prefs,
    enrolledSubjects: enrolledSubjectsText,
  });
  const { disconnect } = live;

  const changeMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "chat") disconnect();
    setMode(m);
  };

  return (
    <div
      className="fixed inset-x-0 flex flex-col bg-gradient-to-b from-emerald-50/70 via-background to-background"
      style={{ top: viewport.top, height: viewport.height }}
    >
      <header className="shrink-0 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 sm:px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-emerald-800">
            <GraduationCap className="h-6 w-6" /><span>SimpleLecture</span>
          </Link>
          <span className="hidden text-sm text-muted-foreground sm:inline">AI Teacher · 1-to-1</span>

          <div className="ml-auto flex items-center gap-2 sm:order-3">
            <button
              type="button"
              onClick={() => setIsPlanModalOpen(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm transition-all",
                isPlan1000
                  ? "border-emerald-300 bg-emerald-100/90 text-emerald-900 hover:bg-emerald-200"
                  : "border-amber-300 bg-amber-100/90 text-amber-900 hover:bg-amber-200"
              )}
              title="Click to view plan details"
            >
              {isPlan1000 ? (
                <>
                  <Sparkles className="h-3 w-3 text-emerald-700" />
                  <span>Pro Plan</span>
                </>
              ) : (
                <>
                  <KeyRound className="h-3 w-3 text-amber-700" />
                  <span>Plus Plan</span>
                  <span className="text-[10px] opacity-80 font-normal hidden sm:inline">
                    ({prefs.apiKey ? "Key Set" : "Needs Key"})
                  </span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setGuideTab("how-to-use");
                setIsGuideOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm hover:bg-accent transition-colors"
              title="Guide: How to use AI Teacher & setup API key"
            >
              <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
              <span className="hidden sm:inline">How to Use & Set Key</span>
              <span className="sm:hidden">Guide</span>
            </button>
            <Link to="/aiteacher/settings" className="rounded-full border p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Settings" title="Settings: your API key, voice and teacher style">
              <SettingsIcon className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex w-full rounded-full border bg-muted/50 p-1 sm:order-2 sm:ml-2 sm:w-auto" role="group" aria-label="Mode">
            <ModeButton active={mode === "voice"} onClick={() => changeMode("voice")} icon={Mic} label="Voice Teacher" />
            <ModeButton active={mode === "chat"} onClick={() => changeMode("chat")} icon={MessageSquareText} label="Chat" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-2 py-2 sm:px-4 sm:py-3">
        {/* If user on BYOK plan hasn't entered key yet, prompt them */}
        {isPlan500 && !prefs.apiKey.trim() && (
          <div className="mb-2 rounded-xl border border-amber-400 bg-amber-50/90 dark:bg-amber-950/60 p-3 text-xs shadow-sm shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  Action Required: Enter your Google Gemini API Key
                </p>
                <p className="text-amber-800 dark:text-amber-300">
                  Your plan uses your personal Google Gemini API key. Paste your key below to start voice and chat classes:
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setGuideTab("api-key");
                    setIsGuideOpen(true);
                  }}
                  className="text-emerald-700 hover:text-emerald-800 hover:underline text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="h-3 w-3" />
                  Guide: How to get key?
                </button>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline text-[11px] font-semibold flex items-center gap-1"
                >
                  Google AI Studio ↗
                </a>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                type="password"
                placeholder="Paste Gemini API key here..."
                value={quickKey}
                onChange={(e) => {
                  setQuickKey(e.target.value);
                  setSavedKeySuccess(false);
                }}
                className="h-8 text-xs bg-background font-mono"
              />
              <Button
                size="sm"
                className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white shrink-0 font-semibold"
                disabled={!quickKey.trim()}
                onClick={() => {
                  updatePrefs({ apiKey: quickKey.trim() });
                  setQuickKey("");
                  setSavedKeySuccess(true);
                }}
              >
                Save Key
              </Button>
            </div>
            {savedKeySuccess && (
              <p className="mt-1 text-green-700 font-semibold text-[11px]">Key saved! You're ready to learn.</p>
            )}
          </div>
        )}

        {subjectsQ.isLoading ? (
          <p className="p-10 text-center text-muted-foreground">Loading your teacher…</p>
        ) : subjectsQ.isError ? (
          <div className="p-10 text-center">
            <p className="mb-3 text-destructive">The AI Teacher could not be reached right now.</p>
            <Button variant="outline" onClick={() => subjectsQ.refetch()}>Try again</Button>
          </div>
        ) : subjects.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">No subjects are available yet. Please check back soon.</p>
        ) : (
          <>
            {/* Both modes stay mounted so switching tabs does not lose the conversation */}
            <div className={cn("min-h-0 flex-1 flex-col", mode === "voice" ? "flex" : "hidden")}>
              <VoiceMode live={live} subjectName={subject?.name ?? null} />
            </div>
            <div className={cn("min-h-0 flex-1 flex-col", mode === "chat" ? "flex" : "hidden")}>
              <ChatMode subjects={availableSubjects} subject={subject} onSubject={setSubject} enrolledSubjects={enrolledSubjectsText} />
            </div>
          </>
        )}
      </main>

      <AITeacherPlanModal open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen} />
      <AITeacherGuideModal open={isGuideOpen} onOpenChange={setIsGuideOpen} defaultTab={guideTab} />
    </div>
  );
}

export default function AITeacher() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { hasActivePlan, isVerifying, refreshSubscription } = useAITeacherSubscription();
  const [selectedPlanForModal, setSelectedPlanForModal] = useState<AITeacherPlanId>("admin_1000");
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<"how-to-use" | "api-key">("how-to-use");

  const handleOpenGuide = (tab: "how-to-use" | "api-key" = "how-to-use") => {
    setGuideTab(tab);
    setIsGuideOpen(true);
  };

  // 1. Loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <GraduationCap className="h-10 w-10 text-emerald-700 animate-pulse mb-3" />
        <p className="text-sm text-muted-foreground">Loading Personal AI Teacher...</p>
      </div>
    );
  }

  // 2. Strict Requirement: Unauthenticated visitors cannot see or use this page
  if (!isAuthenticated) {
    return <AITeacherLoginRequired />;
  }

  // 3. Strict Requirement: Unpurchased students cannot use this service
  if (!hasActivePlan) {
    return (
      <>
        <AITeacherPaywall
          onSelectPlan={(planId) => {
            setSelectedPlanForModal(planId);
            setIsPlanModalOpen(true);
          }}
          isVerifying={isVerifying}
          onRefresh={refreshSubscription}
          onOpenGuide={handleOpenGuide}
        />
        <AITeacherPlanModal
          open={isPlanModalOpen}
          onOpenChange={setIsPlanModalOpen}
          defaultPlanId={selectedPlanForModal}
        />
        <AITeacherGuideModal
          open={isGuideOpen}
          onOpenChange={setIsGuideOpen}
          defaultTab={guideTab}
        />
      </>
    );
  }

  // 4. Authenticated & Purchased student has full 1-to-1 AI Teacher access
  return <AITeacherActive />;
}
