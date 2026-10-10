import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Palette, Languages, UserRound, Volume2, XCircle } from "lucide-react";
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

const Section = ({ icon: Icon, title, hint, children }: { icon: typeof KeyRound; title: string; hint?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
    <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-emerald-700" />{title}</h2>
    {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

export default function AITeacherSettings() {
  const [saved, setSaved] = useState<TeacherPrefs>(loadPrefs);
  const [draft, setDraft] = useState<TeacherPrefs>(saved);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyResult, setKeyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => { document.title = "AI Teacher settings | SimpleLecture"; }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<TeacherPrefs>) => { setDraft((d) => ({ ...d, ...patch })); setJustSaved(false); };

  const save = () => {
    const clean: TeacherPrefs = { ...draft, apiKey: draft.apiKey.trim(), teacherName: draft.teacherName.trim(), custom: draft.custom.trim() };
    savePrefs(clean);
    setSaved(clean);
    setDraft(clean);
    setJustSaved(true);
  };

  const test = async () => {
    setTesting(true); setKeyResult(null);
    setKeyResult(await testOwnKey(draft.apiKey.trim()));
    setTesting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link to="/aiteacher" className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm hover:bg-accent"><ArrowLeft className="h-4 w-4" />Back to class</Link>
          <h1 className="text-base font-semibold">AI Teacher settings</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-28">
        <p className="text-sm text-muted-foreground">These settings are saved only in this browser. Opening the settings ends any class that is running.</p>

        <Section icon={KeyRound} title="Your own API key (optional)" hint="Use your own Google Gemini key instead of the site's. Get one free at aistudio.google.com/apikey.">
          <div className="space-y-2">
            <Label htmlFor="key">Gemini API key</Label>
            <div className="flex gap-2">
              <Input id="key" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="Paste your key here" value={draft.apiKey} onChange={(e) => { set({ apiKey: e.target.value }); setKeyResult(null); }} className="text-base md:text-sm" />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!draft.apiKey.trim() || testing} onClick={test}>
                {testing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Test key
              </Button>
              {draft.apiKey && <Button type="button" variant="ghost" size="sm" onClick={() => { set({ apiKey: "" }); setKeyResult(null); }}>Remove key</Button>}
              {keyResult && (
                <span className={cn("flex items-center gap-1.5 text-sm", keyResult.ok ? "text-green-700" : "text-destructive")}>
                  {keyResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{keyResult.message}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              🔒 Your key stays in this browser. Voice classes connect from your browser straight to Google, and chat answers are also requested straight from your browser. Our server never receives your key. Anyone using this device could see it, so don’t save it on a shared computer.
            </p>
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="ghost" onClick={() => { setDraft(DEFAULT_PREFS); setJustSaved(false); setKeyResult(null); }}>Reset</Button>
          <span className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
            {justSaved && !dirty ? <><Check className="h-4 w-4 text-green-600" />Saved</> : dirty ? "Unsaved changes" : ""}
          </span>
          <Button type="button" onClick={save} disabled={!dirty} className="bg-emerald-700 hover:bg-emerald-800">Save settings</Button>
        </div>
      </div>
    </div>
  );
}
