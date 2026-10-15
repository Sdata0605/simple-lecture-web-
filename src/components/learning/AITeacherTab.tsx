import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  GraduationCap,
  Sparkles,
  Mic,
  MessageSquare,
  KeyRound,
  Zap,
  ArrowRight,
  ExternalLink,
  HelpCircle,
  BookOpen,
  CheckCircle2,
  Lock,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useAITeacherSubscription, type AITeacherPlanId } from "@/lib/aiTeacherSubscription";
import { AITeacherPlanModal } from "@/components/aiteacher/AITeacherPlanModal";
import { cn } from "@/lib/utils";

interface AITeacherTabProps {
  courseId?: string;
  courseName?: string;
  subjectId?: string;
  subjectName?: string;
  chapterId?: string;
  chapterTitle?: string;
  topicId?: string;
  topicTitle?: string;
}

export const AITeacherTab = ({
  courseId,
  courseName,
  subjectId,
  subjectName,
  chapterId,
  chapterTitle,
  topicId,
  topicTitle,
}: AITeacherTabProps) => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { hasActivePlan, isPlan500, isPlan1000, currentPlan } = useAITeacherSubscription();
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<AITeacherPlanId>("admin_1000");

  const effectiveSubject = subjectName || "All Subjects";
  const effectiveTopic = topicTitle || chapterTitle || "Current Chapter";

  const handleOpenPlanModal = (planId: AITeacherPlanId = "admin_1000") => {
    setSelectedPlanId(planId);
    setIsPlanModalOpen(true);
  };

  const handleLaunchVoiceClass = () => {
    const url = effectiveSubject
      ? `/aiteacher?subject=${encodeURIComponent(effectiveSubject)}`
      : "/aiteacher";
    navigate(url);
  };

  const handlePromptClick = (prompt: string) => {
    const url = `/aiteacher?subject=${encodeURIComponent(effectiveSubject)}&prompt=${encodeURIComponent(prompt)}`;
    navigate(url);
  };

  // 1. Unauthenticated Visitor
  if (!isAuthenticated) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-6">
        <Card className="border-2 border-dashed bg-card/60">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-700 mb-2">
              <Lock className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Login to Use Personal AI Teacher</CardTitle>
            <CardDescription className="max-w-md mx-auto">
              1-to-1 Voice & Chat AI Tutoring is an exclusive feature for SimpleLecture students. Sign in to your account to start interactive lessons for {effectiveSubject}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pt-2">
            <Button asChild className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold shadow-sm">
              <Link to="/auth?tab=login">Log In to SimpleLecture</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2. Authenticated but Unpurchased Student
  if (!hasActivePlan) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto py-4">
        {/* Banner */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-50 via-teal-50/40 to-background dark:from-emerald-950/30 dark:via-teal-950/10 dark:to-background p-6 sm:p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                Personal 1-to-1 AI Teacher
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                Study {effectiveSubject} with Your Own AI Voice Tutor
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Connect directly with a dedicated AI teacher who speaks with you in real-time, explains complex problems in {effectiveTopic}, clears your doubts in English or Kannada, and quizzes you for your exams.
              </p>
            </div>

            <div className="shrink-0 flex flex-col gap-2">
              <Button
                size="lg"
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold shadow-md"
                onClick={() => handleOpenPlanModal("admin_1000")}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Unlock AI Teacher
              </Button>
              <span className="text-[11px] text-center text-muted-foreground font-medium">
                Plans start at ₹500
              </span>
            </div>
          </div>
        </div>

        {/* 2 Plan Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="hover:border-primary/50 transition-all flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">Student Key</Badge>
                <KeyRound className="h-4 w-4 text-amber-600" />
              </div>
              <CardTitle className="text-lg">₹500 Plan</CardTitle>
              <CardDescription className="text-xs">
                Use your own free Google Gemini API key
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <ul className="text-xs space-y-1.5 text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  1-to-1 voice & chat teacher for {effectiveSubject}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Unlimited questions & doubt solving
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  You provide your own Gemini API key
                </li>
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-semibold"
                onClick={() => handleOpenPlanModal("byok_500")}
              >
                Choose ₹500 Plan
              </Button>
            </CardContent>
          </Card>

          <Card className="border-2 border-emerald-500/80 bg-emerald-50/30 dark:bg-emerald-950/20 hover:border-emerald-600 transition-all flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <Badge className="bg-emerald-600 text-white text-xs">Admin Key · Most Popular</Badge>
                <Zap className="h-4 w-4 text-emerald-600" />
              </div>
              <CardTitle className="text-lg">₹1,000 Plan</CardTitle>
              <CardDescription className="text-xs">
                Works directly on Admin's high-speed API key
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <ul className="text-xs space-y-1.5 text-muted-foreground">
                <li className="flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Zero setup — start learning in 1 click!
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Powered by Admin's high-speed server key
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Priority voice latency and crystal-clear audio
                </li>
              </ul>
              <Button
                size="sm"
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
                onClick={() => handleOpenPlanModal("admin_1000")}
              >
                Unlock Pro Plan - ₹1,000
              </Button>
            </CardContent>
          </Card>
        </div>

        <AITeacherPlanModal
          open={isPlanModalOpen}
          onOpenChange={setIsPlanModalOpen}
          defaultPlanId={selectedPlanId}
        />
      </div>
    );
  }

  // 3. Authenticated & Purchased Student
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-3">
      {/* Active Header Card */}
      <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-50/90 via-teal-50/50 to-background dark:from-emerald-950/40 dark:via-teal-950/20 dark:to-background p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-emerald-600 text-white shadow-sm">
                <GraduationCap className="h-5 w-5" />
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                1-to-1 AI Teacher · {effectiveSubject}
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Currently focused on: <span className="font-semibold text-foreground">{effectiveTopic}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={cn(
                "px-2.5 py-1 text-xs font-semibold rounded-full border shadow-sm",
                isPlan1000
                  ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                  : "border-amber-300 bg-amber-100 text-amber-900"
              )}
            >
              {isPlan1000 ? "₹1000 Plan (Admin Key)" : "₹500 Plan (Student Key)"}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Change Plan / Settings"
              onClick={() => setIsPlanModalOpen(true)}
            >
              <KeyRound className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="mt-5 pt-4 border-t border-emerald-200/60 dark:border-emerald-800/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-emerald-900 dark:text-emerald-200 font-medium">
            <Volume2 className="h-4 w-4 text-emerald-600 animate-pulse" />
            <span>Interactive voice tutoring is ready for this chapter</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="default"
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold shadow-md"
              onClick={handleLaunchVoiceClass}
            >
              <Mic className="h-4 w-4 mr-2" />
              Start 1-to-1 Voice Class
            </Button>
            <Button
              variant="outline"
              size="default"
              className="border-emerald-300 hover:bg-emerald-50 text-emerald-800 font-semibold"
              asChild
            >
              <Link to={`/aiteacher?subject=${encodeURIComponent(effectiveSubject)}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Open Fullscreen
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Suggested Topic Questions / Shortcuts */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          Quick Practice & Doubts with AI Teacher
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              title: `Explain "${effectiveTopic}" step-by-step`,
              desc: "Listen to a clear, simple breakdown of the main concepts.",
              prompt: `Please explain ${effectiveTopic} in ${effectiveSubject} in simple, easy-to-understand words.`,
              icon: BookOpen,
            },
            {
              title: "3 Most Important Exam Questions",
              desc: "Test your preparation with board-standard practice problems.",
              prompt: `Give me 3 important board exam questions from ${effectiveTopic} in ${effectiveSubject} with answers.`,
              icon: HelpCircle,
            },
            {
              title: "Key Formulas & Revision Summary",
              desc: "Get quick revision notes & formulas to memorize.",
              prompt: `Summarize the most important formulas, definitions, and key points from ${effectiveTopic} in ${effectiveSubject}.`,
              icon: Zap,
            },
            {
              title: "Clear Any Doubt in Voice or Chat",
              desc: "Ask any doubt freely in English or Kannada.",
              prompt: `I have a doubt in ${effectiveTopic}. Can you ask me what I need help with?`,
              icon: MessageSquare,
            },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handlePromptClick(item.prompt)}
                className="flex items-start gap-3 p-4 rounded-xl border bg-card hover:bg-accent/60 hover:border-emerald-500/50 text-left transition-all group shadow-sm"
              >
                <div className="p-2 rounded-lg bg-emerald-100/70 dark:bg-emerald-950/60 text-emerald-700 shrink-0 group-hover:scale-105 transition-transform">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground group-hover:text-emerald-700 transition-colors">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {item.desc}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
              </button>
            );
          })}
        </div>
      </div>

      <AITeacherPlanModal
        open={isPlanModalOpen}
        onOpenChange={setIsPlanModalOpen}
        defaultPlanId={isPlan500 ? "byok_500" : "admin_1000"}
      />
    </div>
  );
};
