import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, HelpCircle, Loader2, Lock, LogIn, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { AITeacherSettingsPanel } from "@/components/aiteacher/AITeacherSettingsPanel";
import { AITeacherGuideModal } from "@/components/aiteacher/AITeacherGuideModal";
import { TEACHER_SETTINGS_KEY } from "@/lib/aiTeacherKeys";

export default function AITeacherSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [guideOpen, setGuideOpen] = useState(false);
  const paymentSuccess = Boolean((location.state as { paymentSuccess?: boolean } | null)?.paymentSuccess);
  const [showPaymentBanner, setShowPaymentBanner] = useState(paymentSuccess);

  useEffect(() => { document.title = "AI Teacher settings | SimpleLecture"; }, []);

  useEffect(() => {
    if (paymentSuccess) queryClient.invalidateQueries({ queryKey: TEACHER_SETTINGS_KEY });
  }, [paymentSuccess, queryClient]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 text-emerald-700 animate-spin mb-2" />
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border bg-card p-6 sm:p-8 text-center space-y-5 shadow-lg">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700">
            <Lock className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold">Login Required</h1>
            <p className="text-xs text-muted-foreground">Please log in to manage your AI Teacher settings.</p>
          </div>
          <Button asChild className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
            <Link to="/auth?tab=login&redirect=/aiteacher/settings">
              <LogIn className="h-4 w-4 mr-2" /> Log In to SimpleLecture
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={goBack} className="gap-1.5 rounded-full">
              <ArrowLeft className="h-4 w-4" />Back
            </Button>
            <h1 className="text-base font-semibold">AI Teacher settings</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGuideOpen(true)}
            className="gap-1.5 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
          >
            <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
            <span>How to Use Guide</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4 pb-16 space-y-4">
        {paymentSuccess && showPaymentBanner && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-medium text-emerald-900 shadow-sm">
            <span className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              Payment successful — AI Teacher Plus is active. Add your Gemini key below to start.
            </span>
            <button type="button" aria-label="Dismiss" onClick={() => setShowPaymentBanner(false)} className="shrink-0 rounded p-0.5 text-emerald-800 hover:bg-emerald-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <AITeacherSettingsPanel />
      </main>

      <AITeacherGuideModal open={guideOpen} onOpenChange={setGuideOpen} defaultTab="how-to-use" />
    </div>
  );
}
