import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Palette, Languages, Sparkles, UserRound, Volume2, XCircle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PREFS, LANGUAGE_OPTIONS, PRESET_OPTIONS, VOICE_OPTIONS,
  loadPrefs, savePrefs, type TeacherPrefs,
} from "@/lib/aiTeacherPrefs";
import { testOwnKey } from "@/lib/aiTeacherChat";
import { useAITeacherSubscription } from "@/lib/aiTeacherSubscription";
import { AITeacherPlanModal } from "@/components/aiteacher/AITeacherPlanModal";
import { AITeacherGuideModal } from "@/components/aiteacher/AITeacherGuideModal";

import { useAuth } from "@/contexts/AuthContext";
import { Lock, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Section = ({ icon: Icon, title, hint, children }: { icon: typeof KeyRound; title: string; hint?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
    <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-emerald-700" />{title}</h2>
    {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

export default function AITeacherSettings() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [saved, setSaved] = useState<TeacherPrefs>(loadPrefs);
  const [draft, setDraft] = useState<TeacherPrefs>(saved);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyResult, setKeyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const { hasActivePlan, isPlan500, isPlan1000, currentPlan } = useAITeacherSubscription();
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<"how-to-use" | "api-key">("api-key");

  useEffect(() => { document.title = "AI Teacher settings | SimpleLecture"; }, []);

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
            <p className="text-xs text-muted-foreground">Please log in to manage your Personal AI Teacher settings.</p>
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

  if (!hasActivePlan) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border bg-card p-6 sm:p-8 text-center space-y-5 shadow-lg">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700">
            <Sparkles className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold">Plan Required</h1>
            <p className="text-xs text-muted-foreground">
              You need an active Personal AI Teacher plan (₹500 or ₹1,000) to customize teacher settings.
            </p>
          </div>
          <Button className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold" onClick={() => setPlanModalOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2" /> View AI Teacher Plans
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/aiteacher">Back to AI Teacher</Link>
          </Button>
        </div>
        <AITeacherPlanModal open={planModalOpen} onOpenChange={setPlanModalOpen} />
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<TeacherPrefs>) => { setDraft((d) => ({ ...d, ...patch })); setJustSaved(false); };

  const save = () => {
    const clean: TeacherPrefs = {
      ...draft,
      apiKey: draft.apiKey.trim(),
      apiMode: draft.apiMode || "admin",
      teacherName: draft.teacherName.trim(),
      custom: draft.custom.trim(),
    };
    savePrefs(clean);
    setSaved(clean);
    setDraft(clean);
    setJustSaved(true);
    toast({
      title: "Settings Saved Successfully",
      description: clean.apiMode === "own" && clean.apiKey
        ? "Active Key: Using your personal Google Gemini API key."
        : "Active Key: Using SimpleLecture Managed Key.",
    });
  };

  const test = async () => {
    setTesting(true); setKeyResult(null);
    setKeyResult(await testOwnKey(draft.apiKey.trim()));
    setTesting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/aiteacher" className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm hover:bg-accent"><ArrowLeft className="h-4 w-4" />Back to class</Link>
            <h1 className="text-base font-semibold">AI Teacher settings</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setGuideTab("how-to-use");
              setGuideOpen(true);
            }}
            className="gap-1.5 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
          >
            <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
            <span>How to Use Guide</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-28">
        <p className="text-sm text-muted-foreground">These settings are saved only in this browser. Opening the settings ends any class that is running.</p>

        <Section icon={Sparkles} title="Your AI Teacher Plan" hint="Manage your personal AI teacher plan & API key mode.">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 bg-muted/30">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base">
                  {hasActivePlan ? currentPlan?.name : "No Active Plan"}
                </span>
                {hasActivePlan && (
                  <span className={cn(
                    "px-2 py-0.5 text-xs font-semibold rounded-full border",
                    isPlan1000 ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-amber-300 bg-amber-100 text-amber-900"
                  )}>
                    {isPlan1000 ? "Pro Plan (₹1,000)" : "Plus Plan (₹500)"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {isPlan1000
                  ? "Your Pro Plan includes built-in AI quota powered by SimpleLecture. Adding your own key is optional and gives you higher rate limits."
                  : isPlan500
                  ? "Your Plus Plan (₹500) uses your personal Google Gemini API key configured in the section below."
                  : "Purchase a plan to unlock 1-to-1 voice and chat tutoring on SimpleLecture."}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="rounded-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => setPlanModalOpen(true)}
            >
              {hasActivePlan ? "Change Plan" : "Choose Plan (₹500 / ₹1000)"}
            </Button>
          </div>
        </Section>

        <Section icon={KeyRound} title="AI Key Source & Personal Gemini Key" hint="Choose whether to use SimpleLecture's built-in managed key or your personal Google Gemini API key.">
          <div className="space-y-4">
            {/* Key Mode Selection Cards */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Active Key Mode</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => set({ apiMode: "admin" })}
                  className={cn(
                    "relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                    draft.apiMode === "admin"
                      ? "border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20 dark:bg-emerald-950/40"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-600">
                    {draft.apiMode === "admin" && <div className="h-2 w-2 rounded-full bg-emerald-600" />}
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-bold text-sm">
                      <span>SimpleLecture Managed Key</span>
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Built-in</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Powered by SimpleLecture's server key pool. Zero setup needed.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => set({ apiMode: "own" })}
                  className={cn(
                    "relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                    draft.apiMode === "own"
                      ? "border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20 dark:bg-emerald-950/40"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-600">
                    {draft.apiMode === "own" && <div className="h-2 w-2 rounded-full bg-emerald-600" />}
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-bold text-sm">
                      <span>My Own Gemini Key</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Higher Limits</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Connect directly using your personal key from Google AI Studio.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Status explanation */}
            {draft.apiMode === "admin" ? (
              <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/70 p-3 text-xs text-emerald-900 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    <strong>Currently Active:</strong> Using SimpleLecture Managed Key. Your classes and chats will run on the platform's key pool.
                  </span>
                </div>
                {draft.apiKey && (
                  <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                    (Personal key saved for later)
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-300/80 bg-amber-50/70 p-3 text-xs text-amber-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Currently Active:</strong> Using your personal Gemini API key below. Higher rate limits apply.
                </span>
              </div>
            )}

            {/* Input field for personal Gemini Key */}
            <div className="rounded-xl border bg-muted/20 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="key" className="text-xs font-semibold">
                  Personal Gemini API Key {draft.apiMode === "admin" && "(Optional / Stored for later)"}
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setGuideTab("api-key");
                    setGuideOpen(true);
                  }}
                  className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold underline flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  How to create & set API key?
                </button>
              </div>
              <div className="flex gap-2">
                <Input
                  id="key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste your Gemini key here (AIzaSy...)"
                  value={draft.apiKey}
                  onChange={(e) => {
                    set({ apiKey: e.target.value });
                    setKeyResult(null);
                  }}
                  className="text-base md:text-sm bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!draft.apiKey.trim() || testing}
                  onClick={test}
                  className="text-xs h-8"
                >
                  {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Test key
                </Button>
                {draft.apiKey && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      set({ apiKey: "" });
                      setKeyResult(null);
                    }}
                    className="text-xs h-8 text-destructive hover:bg-destructive/10"
                  >
                    Remove key
                  </Button>
                )}
                {keyResult && (
                  <span className={cn("flex items-center gap-1.5 text-xs font-semibold", keyResult.ok ? "text-emerald-700" : "text-destructive")}>
                    {keyResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {keyResult.message}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={save}
                  className="ml-auto bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs h-8 shadow-sm flex items-center gap-1"
                >
                  <Check className="h-3.5 w-3.5" />
                  Save Key & Settings
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                🔒 Your key stays strictly in this browser. Voice classes and chat connect straight to Google. Our server never sees or stores your key.
              </p>
            </div>
          </div>
        </Section>

        <Section icon={Volume2} title="Teacher’s voice" hint="Used in voice classes. It applies from the next class you start.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Voice">
            {[{ id: "", desc: "Default" }, ...VOICE_OPTIONS].map((v) => (
              <button key={v.id || "default"} type="button" role="radio" aria-checked={draft.voice === v.id} onClick={() => set({ voice: v.id })}
                className={cn("rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-accent", draft.voice === v.id && "border-emerald-600 bg-emerald-50")}>
                <span className="block text-sm font-semibold">{v.id || "Site default"}</span>
                <span className="block text-xs text-muted-foreground">{v.desc}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section icon={UserRound} title="Teacher’s name">
          <Input value={draft.teacherName} onChange={(e) => set({ teacherName: e.target.value })} maxLength={30} placeholder="e.g. Asha Madam, Ravi Sir" aria-label="Teacher name" className="text-base md:text-sm" />
        </Section>

        <Section icon={Palette} title="Teacher’s personality" hint="How your teacher talks and teaches.">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Personality">
            {PRESET_OPTIONS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={draft.preset === p.id} onClick={() => set({ preset: p.id })}
                className={cn("flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-accent", draft.preset === p.id && "border-emerald-600 bg-emerald-50")}>
                <span className="text-2xl leading-none" aria-hidden>{p.emoji}</span>
                <span><span className="block text-sm font-semibold">{p.label}</span><span className="block text-xs text-muted-foreground">{p.desc}</span></span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom">Anything else? (optional)</Label>
            <Textarea id="custom" value={draft.custom} onChange={(e) => set({ custom: e.target.value })} maxLength={300} rows={3} placeholder="e.g. Call me champ. Use cricket examples. Keep answers short." className="resize-none text-base md:text-sm" />
            <p className="text-right text-xs text-muted-foreground">{draft.custom.length}/300</p>
          </div>
        </Section>

        <Section icon={Languages} title="Reply language">
          <select value={draft.language} onChange={(e) => set({ language: e.target.value })} aria-label="Reply language" className="h-11 w-full rounded-md border bg-background px-3 text-base md:text-sm">
            {LANGUAGE_OPTIONS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur shadow-lg">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setDraft(DEFAULT_PREFS); setJustSaved(false); setKeyResult(null); }}
            className="text-muted-foreground hover:text-foreground"
          >
            Reset to Defaults
          </Button>

          <div className="flex items-center gap-3">
            {justSaved && !dirty && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 animate-in fade-in duration-300">
                <CheckCircle2 className="h-4 w-4" /> Settings Saved!
              </span>
            )}
            {dirty && (
              <span className="text-xs text-amber-700 font-medium hidden sm:inline">
                Unsaved changes
              </span>
            )}
            <Button
              type="button"
              onClick={save}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-6 shadow-md flex items-center gap-2"
            >
              <Check className="h-4 w-4" /> Save Settings
            </Button>
          </div>
        </div>
      </div>

      <AITeacherPlanModal open={planModalOpen} onOpenChange={setPlanModalOpen} />
      <AITeacherGuideModal
        open={guideOpen}
        onOpenChange={(open) => {
          setGuideOpen(open);
          if (!open) {
            const latest = loadPrefs();
            if (latest.apiKey !== draft.apiKey) {
              setDraft((d) => ({ ...d, apiKey: latest.apiKey }));
              setSaved((s) => ({ ...s, apiKey: latest.apiKey }));
            }
          }
        }}
        defaultTab={guideTab}
      />
    </div>
  );
}
