import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, Copy, ExternalLink, Eye, EyeOff, GraduationCap, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AI_TEACHER_VOICES,
  DEFAULT_AI_TEACHER_SETTINGS,
  AITeacherSettings,
  useAITeacherSettings,
  useTestAITeacher,
  useUpdateAITeacherSettings,
} from "@/hooks/useAITeacherSettings";

export function AITeacherSettingsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useAITeacherSettings();
  const update = useUpdateAITeacherSettings();
  const test = useTestAITeacher();
  const [local, setLocal] = useState<AITeacherSettings>(DEFAULT_AI_TEACHER_SETTINGS);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { if (data) setLocal(data); }, [data]);

  const pageUrl = `${window.location.origin}/aiteacher`;
  const set = (patch: Partial<AITeacherSettings>) => setLocal((p) => ({ ...p, ...patch }));

  const copyUrl = async () => {
    await navigator.clipboard.writeText(pageUrl);
    toast({ title: "Link copied", description: pageUrl });
  };

  const r = test.data;
  const row = (ok: boolean, label: string, msg?: string) => (
    <div className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />}
      <span><strong>{label}</strong>{msg ? <span className="text-muted-foreground"> — {msg}</span> : null}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-emerald-600" />
          <div>
            <CardTitle>AI Teacher 1-to-1</CardTitle>
            <CardDescription>
              Public voice + chat teacher page (no login). Uses its own Google Gemini API key, which stays on the server.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable AI Teacher 1-to-1</Label>
                <p className="text-sm text-muted-foreground">When off, the public page shows that the teacher is unavailable.</p>
              </div>
              <Switch checked={local.enabled} onCheckedChange={(enabled) => set({ enabled })} />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span className="font-mono break-all">{pageUrl}</span>
              <Button type="button" variant="outline" size="sm" onClick={copyUrl}><Copy className="h-3.5 w-3.5 mr-1" />Copy</Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href="/aiteacher" target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" />Open</a>
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="aitt-key">Google Gemini API key</Label>
              <div className="flex gap-2">
                <Input
                  id="aitt-key"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  placeholder="AIza..."
                  value={local.google_api_key}
                  onChange={(e) => set({ google_api_key: e.target.value })}
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? "Hide key" : "Show key"}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Get one at Google AI Studio. Visitors never receive this key; the page only gets a short-lived, single-use voice token.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="aitt-live">Voice (Live) model</Label>
                <Input id="aitt-live" value={local.live_model} onChange={(e) => set({ live_model: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aitt-chat">Chat model</Label>
                <Input id="aitt-chat" value={local.chat_model} onChange={(e) => set({ chat_model: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aitt-voice">Teacher voice</Label>
                <Select value={local.voice_name} onValueChange={(voice_name) => set({ voice_name })}>
                  <SelectTrigger id="aitt-voice"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background">
                    {AI_TEACHER_VOICES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="aitt-name">Teacher name</Label>
                <Input id="aitt-name" value={local.teacher_name} onChange={(e) => set({ teacher_name: e.target.value })} />
              </div>
            </div>

            {r && (
              <div className="space-y-2 rounded-md border p-3">
                {row(r.chatModel.ok, `Chat model "${r.chatModel.model}"`, r.chatModel.ok ? "available" : r.chatModel.message)}
                {row(r.liveModel.ok, `Voice model "${r.liveModel.model}"`, r.liveModel.ok ? "available" : r.liveModel.message)}
                {row(r.token.ok, "Voice session token", r.token.ok ? `created (${r.token.lockLevel}, ${r.token.apiVersion})` : r.token.skipped ? "skipped (key or voice model not accepted)" : r.token.message)}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || !local.google_api_key.trim()}
                onClick={() => test.mutate({ google_api_key: local.google_api_key, live_model: local.live_model, chat_model: local.chat_model }, {
                  onError: (e) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
                })}
              >
                {test.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Test key & models
              </Button>
              <Button type="button" onClick={() => update.mutate(local)} disabled={update.isPending}>
                {update.isPending ? "Saving..." : "Save AI Teacher Settings"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
