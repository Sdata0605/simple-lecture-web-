import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  Loader2,
  MessageSquareText,
  Palette,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Volume2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PREFS,
  LANGUAGE_OPTIONS,
  PRESET_OPTIONS,
  VOICE_OPTIONS,
  finishLegacyKeyImport,
  getLegacyKeyForImport,
  type TeacherPrefs,
} from "@/lib/aiTeacherPrefs";
import {
  useAddKey,
  useDeleteKey,
  usePlanState,
  useReorderKeys,
  useSavePrefs,
  useSetActiveKey,
  useTeacherSettings,
  useTestKey,
  useUpdateKey,
} from "@/lib/aiTeacherKeys";
import { TeacherApiError } from "@/lib/aiTeacherApi";
import { useNavigate } from "react-router-dom";

const GET_KEY_URL = "https://aistudio.google.com/app/apikey";

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  rate_limited: { label: "Rate limited", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  invalid: { label: "Invalid", cls: "border-red-300 bg-red-50 text-red-800" },
  untested: { label: "Untested", cls: "border-border bg-muted text-muted-foreground" },
};

/** A clear sentence for a failed request, from the server's error code when there is one. */
export function errorText(e: unknown): string {
  if (e instanceof TeacherApiError) {
    switch (e.code) {
      case "INVALID_KEY": return "Google rejected this key";
      case "KEY_LIMIT": return "You already have 10 keys";
      case "DUPLICATE_KEY": return "This key is already saved";
      case "NOT_FOUND": return "That key no longer exists";
      case "UNAUTHORIZED": return "Please log in again";
      case "NO_KEYS": return "Add a key first";
      case "ALL_KEYS_FAILED": return "None of your keys worked. See their status below.";
      case "PLAN_REQUIRED": return "Buy the Plus plan first to add your own keys";
    }
  }
  return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
}

const Section = ({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }) => (
  <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
    <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-emerald-700" />{title}</h2>
    {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

/**
 * The student's AI Teacher settings: the Gemini key manager, the teacher's voice, name, personality and reply
 * language. Used on the /aiteacher/settings page and inside the Ask AI overlay (where onClose goes back).
 */
export function AITeacherSettingsPanel({ onClose }: { onClose?: () => void }) {
  const { data: settings } = useTeacherSettings();
  const keys = settings.keys;
  const addKey = useAddKey();
  const updateKey = useUpdateKey();
  const deleteKey = useDeleteKey();
  const reorderKeys = useReorderKeys();
  const setActiveKey = useSetActiveKey();
  const testKey = useTestKey();
  const savePrefs = useSavePrefs();

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceValue, setReplaceValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const navigate = useNavigate();
  const { state: planState, retry: retryPlan } = usePlanState();
  const planActive = planState === "active";

  // One-time import of a key that was saved in this browser before keys moved to the account.
  const [legacyKey, setLegacyKey] = useState<string | null>(getLegacyKeyForImport);

  const [draft, setDraft] = useState<TeacherPrefs>(settings.prefs);
  const [baseline, setBaseline] = useState<TeacherPrefs>(settings.prefs);
  useEffect(() => {
    setDraft(settings.prefs);
    setBaseline(settings.prefs);
  }, [settings.prefs]);

  const busy = addKey.isPending || updateKey.isPending || deleteKey.isPending || reorderKeys.isPending
    || setActiveKey.isPending || testKey.isPending || savePrefs.isPending;
  const done = (text: string) => setNotice({ ok: true, text });
  const fail = (e: unknown) => setNotice({ ok: false, text: errorText(e) });
  const count = keys.length;
  const full = count >= settings.maxKeys;

  const answerImport = (yes: boolean) => {
    const key = legacyKey;
    setLegacyKey(null);
    finishLegacyKeyImport();
    if (!yes || !key) return;
    addKey.mutate(
      { label: "Imported key", apiKey: key },
      { onSuccess: () => done("Key saved to your account."), onError: fail },
    );
  };

  const onAdd = () => {
    addKey.mutate(
      { label: newLabel.trim() || `Key ${count + 1}`, apiKey: newKey.trim() },
      {
        onSuccess: () => {
          setNewKey("");
          setNewLabel("");
          setShowNewKey(false);
          done("Key added.");
        },
        onError: fail,
      },
    );
  };

  const commitLabel = (id: string, original: string) => {
    const value = (labels[id] ?? original).trim();
    if (!value || value === original) return;
    updateKey.mutate({ id, label: value }, { onError: fail });
  };

  const saveReplacement = (id: string) => {
    updateKey.mutate(
      { id, apiKey: replaceValue.trim() },
      {
        onSuccess: () => {
          setReplacingId(null);
          setReplaceValue("");
          done("Key replaced.");
        },
        onError: fail,
      },
    );
  };

  const onDelete = (id: string) => {
    if (!window.confirm("Delete this key from your account?")) return;
    deleteKey.mutate({ id }, { onSuccess: () => done("Key deleted."), onError: fail });
  };

  const move = (index: number, dir: -1 | 1) => {
    const ids = keys.map((k) => k.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorderKeys.mutate({ ids }, { onError: fail });
  };

  const onTest = (id: string) => {
    testKey.mutate(
      { id },
      {
        onSuccess: (data) => {
          const k = data.keys.find((x) => x.id === id);
          if (k?.status === "active") done("Key works.");
          else if (k?.lastError) setNotice({ ok: false, text: `Not working: ${k.lastError}` });
          else setNotice({ ok: false, text: `Status: ${STATUS[k?.status ?? ""]?.label ?? "unknown"}` });
        },
        onError: fail,
      },
    );
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const set = (patch: Partial<TeacherPrefs>) => setDraft((d) => ({ ...d, ...patch }));

  const savePersona = () => {
    const clean: TeacherPrefs = {
      ...draft,
      teacherName: draft.teacherName.trim(),
      custom: draft.custom.trim(),
    };
    savePrefs.mutate({ prefs: clean }, { onSuccess: () => done("Settings saved."), onError: fail });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {onClose && (
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />Back
          </Button>
        )}
        <h1 className="text-base font-semibold">AI Teacher settings</h1>
      </div>

      {planState === "active" && (
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />Plus plan active
          </span>
        </div>
      )}

      {planState === "loading" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking your plan…
        </p>
      )}

      {planState === "unknown" && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Could not check your plan.
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={retryPlan}>Retry</Button>
        </p>
      )}

      {planState === "inactive" && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 shadow-sm sm:p-5 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-amber-950 dark:text-amber-100">
                <Sparkles className="h-4 w-4 text-amber-600" />AI Teacher Plus
              </h2>
              <p className="text-2xl font-extrabold text-foreground">Rs 500 <span className="text-xs font-medium text-muted-foreground">one-time</span></p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>• 1-to-1 AI teacher for voice and chat classes</li>
                <li>• Add up to 10 of your own Gemini keys</li>
                <li>• Automatically switches to the next key if one stops working</li>
              </ul>
            </div>
            <Button type="button" className="h-10 gap-2 bg-emerald-700 font-bold text-white hover:bg-emerald-800" onClick={() => navigate("/aiteacher/plus")}>
              <CreditCard className="h-4 w-4" />Buy Plus for Rs 500
            </Button>
          </div>
        </section>
      )}

      {legacyKey && planActive && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950">
          <span className="font-medium">Save the key from this browser to your account?</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-8 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => answerImport(true)} disabled={busy}>
              Yes
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => answerImport(false)}>
              No
            </Button>
          </div>
        </div>
      )}

      <Section
        icon={KeyRound}
        title="Your Gemini keys"
        hint="Add up to 10 keys. If one runs out, the next is used automatically."
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold">{count} of {settings.maxKeys} keys</span>
          <a href={GET_KEY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
            Get a free key <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {notice && (
          <div className={cn("flex items-center gap-2 rounded-lg border p-2.5 text-xs font-semibold",
            notice.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/30 bg-destructive/10 text-destructive")}>
            {notice.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        {count === 0 && planState !== "loading" && planState !== "unknown" && (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            {planActive ? "No keys yet. Add one below to start your lessons." : "No keys yet. Buy Plus to add your own keys."}
          </p>
        )}

        <ul className="space-y-3">
          {keys.map((k, i) => {
            const status = STATUS[k.status] ?? STATUS.untested;
            const isActive = settings.activeKeyId === k.id;
            const testing = testKey.isPending && testKey.variables?.id === k.id;
            if (!planActive) {
              return (
                <li key={k.id} className="space-y-2 rounded-xl border p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{k.label}</span>
                    <code className="font-mono text-xs text-muted-foreground">{k.masked}</code>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", status.cls)}>{status.label}</span>
                    {isActive && <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">In use</span>}
                  </div>
                  {k.lastError && <p className="text-xs text-destructive">{k.lastError}</p>}
                </li>
              );
            }
            return (
              <li key={k.id} className="space-y-2.5 rounded-xl border p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Label for key ${i + 1}`}
                    value={labels[k.id] ?? k.label}
                    maxLength={40}
                    onChange={(e) => setLabels((l) => ({ ...l, [k.id]: e.target.value }))}
                    onBlur={() => commitLabel(k.id, k.label)}
                    className="h-8 w-44 text-sm"
                  />
                  <code className="font-mono text-xs text-muted-foreground">{k.masked}</code>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", status.cls)}>{status.label}</span>
                  {isActive && <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">In use</span>}
                </div>
                {k.lastError && <p className="text-xs text-destructive">{k.lastError}</p>}

                <div className="flex flex-wrap gap-1.5">

                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => onTest(k.id)}>
                    {testing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Test
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                    onClick={() => { setReplacingId(k.id); setReplaceValue(""); }}>
                    Replace key
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy || isActive}
                    onClick={() => setActiveKey.mutate({ id: k.id }, { onSuccess: () => done("Active key changed."), onError: fail })}>
                    <Star className="mr-1 h-3 w-3" />Set as active
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={busy || i === 0}
                    onClick={() => move(i, -1)} aria-label="Move key up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={busy || i === count - 1}
                    onClick={() => move(i, 1)} aria-label="Move key down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy}
                    onClick={() => onDelete(k.id)}>
                    <Trash2 className="mr-1 h-3 w-3" />Delete
                  </Button>
                </div>

                {replacingId === k.id && (
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="New Gemini key (AIzaSy...)"
                      value={replaceValue}
                      onChange={(e) => setReplaceValue(e.target.value)}
                      className="h-8 font-mono text-xs"
                    />
                    <Button type="button" size="sm" className="h-8 bg-emerald-700 text-white hover:bg-emerald-800" disabled={!replaceValue.trim() || busy}
                      onClick={() => saveReplacement(k.id)}>
                      Save key
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setReplacingId(null)}>Cancel</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {planActive && <div className="space-y-2.5 rounded-xl border bg-muted/20 p-3.5">
          <p className="text-sm font-semibold">Add a key</p>
          <Input
            aria-label="New key label"
            placeholder="Label, e.g. Home laptop"
            value={newLabel}
            maxLength={40}
            onChange={(e) => setNewLabel(e.target.value)}
            className="h-9 bg-background text-sm"
            disabled={full}
          />
          <div className="flex gap-2">
            <Input
              aria-label="New Gemini key"
              type={showNewKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your Gemini key (AIzaSy...)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="h-9 bg-background font-mono text-xs"
              disabled={full}
            />
            <Button type="button" variant="outline" size="icon" onClick={() => setShowNewKey((v) => !v)} aria-label={showNewKey ? "Hide key" : "Show key"}>
              {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {full ? "You have 10 keys. Delete one to add another." : "Keys are checked by Google when you add them."}
            </span>
            <Button type="button" size="sm" className="h-8 gap-1 bg-emerald-700 text-white hover:bg-emerald-800"
              disabled={full || !newKey.trim() || busy} onClick={onAdd}>
              {addKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add key
            </Button>
          </div>
        </div>}
      </Section>

      <Section icon={UserRound} title="Teacher’s name">
        <Input value={draft.teacherName} onChange={(e) => set({ teacherName: e.target.value })} maxLength={30} placeholder="e.g. Asha Madam, Ravi Sir" aria-label="Teacher name" className="text-base md:text-sm" />
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
      </Section>

      <Section icon={Languages} title="Reply language">
        <select value={draft.language} onChange={(e) => set({ language: e.target.value })} aria-label="Reply language" className="h-11 w-full rounded-md border bg-background px-3 text-base md:text-sm">
          {LANGUAGE_OPTIONS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </Section>

      <Section icon={MessageSquareText} title="Custom instructions" hint="Optional. Tell your teacher anything else it should know.">
        <div className="space-y-1.5">
          <Label htmlFor="custom">Anything else? (optional)</Label>
          <Textarea id="custom" value={draft.custom} onChange={(e) => set({ custom: e.target.value })} maxLength={300} rows={3} placeholder="e.g. Call me champ. Use cricket examples. Keep answers short." className="resize-none text-base md:text-sm" />
          <p className="text-right text-xs text-muted-foreground">{draft.custom.length}/300</p>
        </div>
      </Section>

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_PREFS)} className="text-muted-foreground hover:text-foreground">
          Reset to defaults
        </Button>
        <div className="flex items-center gap-3">
          {dirty && <span className="hidden text-xs font-medium text-amber-700 sm:inline">Unsaved changes</span>}
          <Button type="button" onClick={savePersona} disabled={!dirty || busy} className="flex items-center gap-2 bg-emerald-700 px-6 font-bold text-white shadow-md hover:bg-emerald-800">
            {savePrefs.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AITeacherSettingsPanel;
