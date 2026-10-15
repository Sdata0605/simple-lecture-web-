import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  KeyRound,
  Mic,
  MessageSquare,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
  ShieldCheck,
  Zap,
  GraduationCap,
  Layers,
} from "lucide-react";
import { loadPrefs, savePrefs } from "@/lib/aiTeacherPrefs";
import { testOwnKey } from "@/lib/aiTeacherChat";
import { useAITeacherSubscription } from "@/lib/aiTeacherSubscription";
import { cn } from "@/lib/utils";

interface AITeacherGuideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "how-to-use" | "api-key";
}

export function AITeacherGuideModal({
  open,
  onOpenChange,
  defaultTab = "how-to-use",
}: AITeacherGuideModalProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { isPlan1000, isPlan500 } = useAITeacherSubscription();

  // Load existing key when modal opens
  useEffect(() => {
    if (open) {
      const prefs = loadPrefs();
      setApiKey(prefs.apiKey || "");
      setTestResult(null);
      setSaveSuccess(false);
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);

  const handleTestKey = async () => {
    const keyToTest = apiKey.trim();
    if (!keyToTest) return;
    setTesting(true);
    setTestResult(null);
    const result = await testOwnKey(keyToTest);
    setTestResult(result);
    setTesting(false);
  };

  const handleSaveKey = () => {
    const cleanKey = apiKey.trim();
    savePrefs({ apiKey: cleanKey });
    setSaveSuccess(true);
    setTestResult(null);
  };

  const handleRemoveKey = () => {
    savePrefs({ apiKey: "" });
    setApiKey("");
    setSaveSuccess(false);
    setTestResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-1.5 pb-2 border-b">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <GraduationCap className="h-5 w-5" />
            </span>
            <DialogTitle className="text-xl font-bold">
              AI Teacher Guide & API Key Setup
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Everything you need to know about using your 1-to-1 Personal AI Teacher and setting up your Google Gemini API key.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2 space-y-4">
          <TabsList className="grid w-full grid-cols-2 p-1 bg-muted/80 rounded-xl">
            <TabsTrigger value="how-to-use" className="gap-2 text-xs sm:text-sm font-semibold py-2">
              <BookOpen className="h-4 w-4" />
              How to Use
            </TabsTrigger>
            <TabsTrigger value="api-key" className="gap-2 text-xs sm:text-sm font-semibold py-2">
              <KeyRound className="h-4 w-4" />
              Create & Set API Key
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: HOW TO USE */}
          <TabsContent value="how-to-use" className="space-y-4 pt-1">
            {/* Quick Summary Card */}
            <div className="rounded-xl border bg-gradient-to-r from-emerald-50/80 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/20 p-4 space-y-2">
              <h3 className="font-bold text-sm text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-emerald-700" />
                What is the Personal AI Teacher?
              </h3>
              <p className="text-xs text-emerald-800/90 dark:text-emerald-300 leading-relaxed">
                Your AI Teacher is an interactive 1-to-1 tutor that talks aloud with you, listens to your questions through your microphone, explains concepts step-by-step, draws visual notes and slides in real-time, and tests you with practice quizzes.
              </p>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3.5 rounded-xl border bg-card shadow-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white text-xs font-bold">
                  1
                </span>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Mic className="h-4 w-4 text-emerald-600" />
                    Start 1-to-1 Voice Class
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Click <strong>"Start Class"</strong> and allow microphone access. Speak naturally like talking to a real teacher sitting with you. Ask questions like:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-[11px] bg-muted px-2 py-0.5 rounded-md font-medium text-foreground">
                      "Teach me Quadratic Equations"
                    </span>
                    <span className="text-[11px] bg-muted px-2 py-0.5 rounded-md font-medium text-foreground">
                      "Explain Newton's laws in Kannada"
                    </span>
                    <span className="text-[11px] bg-muted px-2 py-0.5 rounded-md font-medium text-foreground">
                      "I have a doubt in chapter 3"
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl border bg-card shadow-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white text-xs font-bold">
                  2
                </span>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-emerald-600" />
                    Visual Slides & Interactive Quizzes
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    While the teacher explains aloud, structured bullet points, formulas, and visual diagram cards generate automatically on your screen. The teacher also pauses to give you quick 4-option quizzes to test your understanding.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl border bg-card shadow-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white text-xs font-bold">
                  3
                </span>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-emerald-600" />
                    Switch to 24/7 Chat Mode
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Prefer reading or typing questions silently in a library? Click the <strong>"Chat"</strong> button at the top of the screen to switch to text mode anytime. You can ask doubts, generate exam notes, and practice questions 24/7.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl border bg-card shadow-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white text-xs font-bold">
                  4
                </span>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-emerald-600" />
                    Switch Subjects Anytime
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Simply say <em>"I want to study Science"</em> or mention any of your enrolled subjects to switch conversationally during class.
                  </p>
                </div>
              </div>
            </div>

            {/* Plan Info box */}
            <div className="rounded-xl border p-3.5 bg-muted/40 space-y-2 text-xs">
              <h4 className="font-bold text-foreground flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-amber-600" />
                Understanding Your AI Teacher Plan:
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-lg border bg-card space-y-1">
                  <span className="font-bold text-emerald-800 dark:text-emerald-300 block">
                    Pro Plan (₹1,000)
                  </span>
                  <p className="text-muted-foreground">
                    All-inclusive AI Teacher powered by SimpleLecture's high-speed servers. <strong>Zero setup required</strong>. Adding your own key in Settings is optional for higher rate limits.
                  </p>
                </div>
                <div className="p-2.5 rounded-lg border bg-card space-y-1">
                  <span className="font-bold text-amber-800 dark:text-amber-300 block">
                    Plus Plan (₹500)
                  </span>
                  <p className="text-muted-foreground">
                    Affordable plan using your own personal Google Gemini API key. See the next tab to get and set your key!
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: CREATE & SET API KEY */}
          <TabsContent value="api-key" className="space-y-5 pt-1">
            {/* Step-by-Step Instructions to Create Key */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-emerald-700" />
                  How to Get a Free Google Gemini API Key
                </h3>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  Open Google AI Studio <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              <div className="space-y-2.5 text-xs text-muted-foreground">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold mt-0.5">
                    1
                  </span>
                  <span>
                    Go to <strong>Google AI Studio</strong> at{" "}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary font-semibold underline"
                    >
                      aistudio.google.com/apikey
                    </a>{" "}
                    and sign in with any personal Google / Gmail account (it's 100% free with no credit card required).
                  </span>
                </div>

                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold mt-0.5">
                    2
                  </span>
                  <span>
                    Click the blue button labeled <strong>"Create API key"</strong> (or "Get API key").
                  </span>
                </div>

                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold mt-0.5">
                    3
                  </span>
                  <span>
                    Select <strong>"Create API key in new project"</strong> from the dropdown. Google will generate your unique key within 3 seconds.
                  </span>
                </div>

                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold mt-0.5">
                    4
                  </span>
                  <span>
                    Click the <strong>Copy icon</strong> to copy your secret key string (starts with <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground font-semibold">AIzaSy...</code>).
                  </span>
                </div>

                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-bold mt-0.5">
                    5
                  </span>
                  <span>
                    Paste the key in the input box below and click <strong>"Save Key"</strong>.
                  </span>
                </div>
              </div>

              <div className="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs font-semibold border-emerald-300 hover:bg-emerald-50 text-emerald-800"
                  asChild
                >
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Visit Google AI Studio to Create Key ↗
                  </a>
                </Button>
              </div>
            </div>

            {/* Set & Test API Key Form */}
            <div className="rounded-xl border p-4 bg-card shadow-sm space-y-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    Set Your Gemini API Key
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Paste your key here to activate it for your 1-to-1 classes.
                  </p>
                </div>
                {apiKey.trim() ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> Key Set
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-300">
                    Key Not Set
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="guide-api-key" className="text-xs font-semibold">
                  Google Gemini API Key
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="guide-api-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="AIzaSy..."
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setSaveSuccess(false);
                      setTestResult(null);
                    }}
                    className="font-mono text-xs bg-background"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                  disabled={!apiKey.trim()}
                  onClick={handleSaveKey}
                >
                  Save Key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs font-semibold"
                  disabled={!apiKey.trim() || testing}
                  onClick={handleTestKey}
                >
                  {testing ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    "Test Key"
                  )}
                </Button>
                {apiKey.trim() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs text-destructive hover:text-destructive"
                    onClick={handleRemoveKey}
                  >
                    Remove Key
                  </Button>
                )}
              </div>

              {/* Feedback messages */}
              {saveSuccess && (
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 p-2.5 rounded-lg border border-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>API Key saved successfully! Your AI Teacher is ready to connect.</span>
                </div>
              )}

              {testResult && (
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs font-medium p-2.5 rounded-lg border",
                    testResult.ok
                      ? "text-emerald-800 bg-emerald-50 border-emerald-300"
                      : "text-destructive bg-destructive/10 border-destructive/30"
                  )}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Security info */}
              <div className="flex items-start gap-2 pt-1 text-[11px] text-muted-foreground leading-relaxed">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>100% Private & Secure:</strong> Your API key is stored only inside your browser's local storage and used directly to communicate with Google. Our backend servers never receive, store, or log your personal key.
                </span>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-3 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close Guide
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
