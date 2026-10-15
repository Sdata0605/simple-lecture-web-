import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GraduationCap,
  KeyRound,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Layers,
  Settings as SettingsIcon,
  IndianRupee,
  Zap,
  Play,
  Loader2,
  Check,
  HelpCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AITeacherSettings,
  AITeacherKeyItem,
  AI_TEACHER_VOICES,
  AI_TEACHER_PERSONALITIES,
  AI_TEACHER_LANGUAGES,
  DEFAULT_AI_TEACHER_SETTINGS,
  useAITeacherSettings,
  useUpdateAITeacherSettings,
  useTestAITeacher,
  testGeminiKey,
} from "@/hooks/useAITeacherSettings";

const MAX_KEYS = 100;

export default function AdminAITeacher() {
  const { toast } = useToast();
  const { data: serverSettings, isLoading } = useAITeacherSettings();
  const updateSettings = useUpdateAITeacherSettings();
  const testAITeacher = useTestAITeacher();

  const [local, setLocal] = useState<AITeacherSettings>(DEFAULT_AI_TEACHER_SETTINGS);
  const [activeTab, setActiveTab] = useState("keys-pool");
  const [bulkInput, setBulkInput] = useState("");
  const [singleKeyInput, setSingleKeyInput] = useState("");
  const [singleLabelInput, setSingleLabelInput] = useState("");
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [isBulkTesting, setIsBulkTesting] = useState(false);
  const [bulkTestProgress, setBulkTestProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    document.title = "AI Teacher Management | SimpleLecture Admin";
  }, []);

  useEffect(() => {
    if (serverSettings) {
      setLocal(serverSettings);
    }
  }, [serverSettings]);

  const patchLocal = (patch: Partial<AITeacherSettings>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
  };

  const pool = local.key_pool || [];
  const activeCount = pool.filter((k) => k.status === "active").length;
  const rateLimitedCount = pool.filter((k) => k.status === "rate_limited").length;
  const invalidCount = pool.filter((k) => k.status === "invalid").length;
  const untestedCount = pool.filter((k) => k.status === "untested").length;

  const toggleShowKey = (id: string) => {
    setShowKeyMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = async (text: string, label = "Key") => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  };

  /**
   * Parses raw bulk text into clean unique keys
   */
  const parseBulkKeys = (text: string): string[] => {
    const rawItems = text
      .split(/[\r\n,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 10);
    return [...new Set(rawItems)];
  };

  const detectedBulkKeys = parseBulkKeys(bulkInput);

  /**
   * Adds bulk keys into the key pool (up to 100)
   */
  const handleAddBulkKeys = () => {
    if (detectedBulkKeys.length === 0) {
      toast({
        title: "No keys detected",
        description: "Please paste at least one valid Gemini API key.",
        variant: "destructive",
      });
      return;
    }

    const existingKeys = new Set(pool.map((k) => k.key));
    const newItems: AITeacherKeyItem[] = [];

    for (const k of detectedBulkKeys) {
      if (!existingKeys.has(k)) {
        if (pool.length + newItems.length >= MAX_KEYS) {
          toast({
            title: "Limit Reached",
            description: `Maximum ${MAX_KEYS} keys allowed in the pool. Excess keys were omitted.`,
          });
          break;
        }
        newItems.push({
          id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          key: k,
          label: `Key #${pool.length + newItems.length + 1}`,
          status: "untested",
          addedAt: new Date().toISOString(),
        });
        existingKeys.add(k);
      }
    }

    if (newItems.length === 0) {
      toast({
        title: "No new keys",
        description: "All entered keys are already in the pool.",
      });
      return;
    }

    const updatedPool = [...pool, ...newItems].slice(0, MAX_KEYS);
    patchLocal({
      key_pool: updatedPool,
      google_api_key: local.google_api_key || updatedPool[0]?.key || "",
    });
    setBulkInput("");
    toast({
      title: "Keys Added",
      description: `Added ${newItems.length} key(s) to the pool. Total: ${updatedPool.length}/${MAX_KEYS}.`,
    });
  };

  /**
   * Adds a single key into the key pool
   */
  const handleAddSingleKey = () => {
    const key = singleKeyInput.trim();
    if (!key) {
      toast({ title: "API Key required", description: "Please enter a Gemini API key.", variant: "destructive" });
      return;
    }

    if (pool.length >= MAX_KEYS) {
      toast({ title: "Pool Full", description: `You have reached the maximum limit of ${MAX_KEYS} keys.`, variant: "destructive" });
      return;
    }

    const exists = pool.some((k) => k.key === key);
    if (exists) {
      toast({ title: "Duplicate Key", description: "This key is already present in the pool.", variant: "destructive" });
      return;
    }

    const newItem: AITeacherKeyItem = {
      id: `key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      key,
      label: singleLabelInput.trim() || `Key #${pool.length + 1}`,
      status: "untested",
      addedAt: new Date().toISOString(),
    };

    const updatedPool = [...pool, newItem];
    patchLocal({
      key_pool: updatedPool,
      google_api_key: local.google_api_key || key,
    });
    setSingleKeyInput("");
    setSingleLabelInput("");
    toast({ title: "Key Added", description: `Key "${newItem.label}" added to the pool.` });
  };

  /**
   * Delete an individual key from the pool
   */
  const handleDeleteKey = (id: string) => {
    const updated = pool.filter((k) => k.id !== id);
    const newPrimaryKey = local.google_api_key === pool.find((k) => k.id === id)?.key
      ? updated[0]?.key || ""
      : local.google_api_key;

    patchLocal({
      key_pool: updated,
      google_api_key: newPrimaryKey,
    });
    toast({ title: "Key Removed", description: "Key has been removed from the pool." });
  };

  /**
   * Test an individual key
   */
  const handleTestSingleKey = async (item: AITeacherKeyItem) => {
    setTestingKeyId(item.id);
    const res = await testGeminiKey(item.key);
    setTestingKeyId(null);

    const updated = pool.map((k) => {
      if (k.id === item.id) {
        return {
          ...k,
          status: res.status,
          lastTestedAt: new Date().toISOString(),
          lastErrorMessage: res.ok ? undefined : res.message,
        };
      }
      return k;
    });

    patchLocal({ key_pool: updated });

    if (res.ok) {
      toast({ title: "Key Verified", description: `"${item.label || 'Key'}" is working and active.` });
    } else {
      toast({
        title: "Test Failed",
        description: `"${item.label || 'Key'}": ${res.message}`,
        variant: res.status === "rate_limited" ? "default" : "destructive",
      });
    }
  };

  /**
   * Test all keys in the pool sequentially/concurrently
   */
  const handleTestAllKeys = async () => {
    if (pool.length === 0) {
      toast({ title: "Empty Pool", description: "Add at least one API key to test." });
      return;
    }

    setIsBulkTesting(true);
    setBulkTestProgress({ current: 0, total: pool.length });

    const updated: AITeacherKeyItem[] = [...pool];
    let workingCount = 0;
    let rateLimited = 0;
    let failedCount = 0;

    for (let i = 0; i < pool.length; i++) {
      setBulkTestProgress({ current: i + 1, total: pool.length });
      const item = pool[i];
      const res = await testGeminiKey(item.key);

      if (res.ok) workingCount++;
      else if (res.status === "rate_limited") rateLimited++;
      else failedCount++;

      updated[i] = {
        ...item,
        status: res.status,
        lastTestedAt: new Date().toISOString(),
        lastErrorMessage: res.ok ? undefined : res.message,
      };
    }

    patchLocal({ key_pool: updated });
    setIsBulkTesting(false);
    setBulkTestProgress(null);

    toast({
      title: "Batch Key Test Complete",
      description: `Results: ${workingCount} active, ${rateLimited} rate-limited, ${failedCount} invalid.`,
    });
  };

  const handleClearInvalidKeys = () => {
    const validKeys = pool.filter((k) => k.status !== "invalid");
    const removedCount = pool.length - validKeys.length;
    if (removedCount === 0) {
      toast({ title: "No invalid keys", description: "No invalid keys found in the pool." });
      return;
    }
    patchLocal({ key_pool: validKeys });
    toast({ title: "Cleaned Pool", description: `Removed ${removedCount} invalid key(s).` });
  };

  const handleSaveAll = () => {
    updateSettings.mutate(local);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              <GraduationCap className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              AI Teacher Management
            </h1>
            <Badge
              variant={local.enabled ? "default" : "secondary"}
              className={local.enabled ? "bg-emerald-700 text-white" : "bg-muted text-muted-foreground"}
            >
              {local.enabled ? "Service Active" : "Service Disabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Configure up to 100 Gemini API keys with automatic failover, voice personality models, and student plan pricing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" asChild>
            <a href="/aiteacher" target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Open Live Student Page
            </a>
          </Button>

          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={updateSettings.isPending || isLoading}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold shadow-sm"
          >
            {updateSettings.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-1.5" />
                Save AI Teacher Settings
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 shadow-sm bg-card border">
          <div className="text-xs font-medium text-muted-foreground">Service Status</div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                local.enabled ? "bg-emerald-600 animate-pulse" : "bg-muted-foreground"
              }`}
            />
            <span className="text-lg font-bold text-foreground">
              {local.enabled ? "Online" : "Offline"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {local.enabled ? "Students can access /aiteacher" : "Page shows unavailable"}
          </p>
        </Card>

        <Card className="p-4 shadow-sm bg-card border">
          <div className="text-xs font-medium text-muted-foreground">API Key Pool</div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-foreground">{pool.length}</span>
            <span className="text-xs text-muted-foreground">/ {MAX_KEYS} keys</span>
          </div>
          <p className="text-[11px] text-emerald-700 font-medium mt-1">
            {activeCount} Active · {rateLimitedCount} Rate-Ltd · {invalidCount} Invalid
          </p>
        </Card>

        <Card className="p-4 shadow-sm bg-card border">
          <div className="text-xs font-medium text-muted-foreground">Student Key Plan (BYOK)</div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              ₹{local.plan_pricing?.byok_price ?? 500}
            </span>
            <span className="text-xs text-muted-foreground">one-time</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Uses student's personal key</p>
        </Card>

        <Card className="p-4 shadow-sm bg-card border">
          <div className="text-xs font-medium text-muted-foreground">Pro Managed Plan</div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              ₹{local.plan_pricing?.admin_price ?? 1000}
            </span>
            <span className="text-xs text-muted-foreground">one-time</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Runs on Admin Key Pool</p>
        </Card>
      </div>

      {/* Main Tabs Container */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 p-1 bg-muted/80 rounded-xl h-auto">
          <TabsTrigger value="keys-pool" className="gap-2 py-2.5 font-semibold text-xs sm:text-sm">
            <KeyRound className="h-4 w-4" />
            <span>API Keys Pool ({pool.length}/100)</span>
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2 py-2.5 font-semibold text-xs sm:text-sm">
            <IndianRupee className="h-4 w-4" />
            <span>Plan Pricing</span>
          </TabsTrigger>
          <TabsTrigger value="voice-models" className="gap-2 py-2.5 font-semibold text-xs sm:text-sm">
            <Sparkles className="h-4 w-4" />
            <span>Voice & Models</span>
          </TabsTrigger>
          <TabsTrigger value="diagnostic" className="gap-2 py-2.5 font-semibold text-xs sm:text-sm">
            <Play className="h-4 w-4" />
            <span>System Diagnostic</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: API KEYS POOL (UP TO 100 KEYS) */}
        <TabsContent value="keys-pool" className="space-y-5">
          {/* Master Enablement Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Service Master Switch</CardTitle>
                  <CardDescription className="text-xs">
                    Enable or disable the AI Teacher 1-to-1 feature site-wide.
                  </CardDescription>
                </div>
                <Switch
                  checked={local.enabled}
                  onCheckedChange={(enabled) => patchLocal({ enabled })}
                />
              </div>
            </CardHeader>
          </Card>

          {/* Failover & Multi-Key Pool Manager */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    <span>Gemini API Key Pool (Up to 100 Keys with Auto-Failover)</span>
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    When one key reaches its rate limit (HTTP 429) or is unavailable, the server automatically fails over to the next healthy key in the pool.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold">
                    {activeCount} Active
                  </Badge>
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold">
                    {rateLimitedCount} Rate-Limited
                  </Badge>
                  <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-800 text-xs font-semibold">
                    {invalidCount} Invalid
                  </Badge>
                  <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-800 text-xs font-semibold">
                    {untestedCount} Untested
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Add Keys Sub-Tabs */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
                <Tabs defaultValue="bulk" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <TabsList className="bg-background border">
                      <TabsTrigger value="bulk" className="text-xs font-semibold">
                        Bulk Add Keys (Up to 100)
                      </TabsTrigger>
                      <TabsTrigger value="single" className="text-xs font-semibold">
                        Add Single Key
                      </TabsTrigger>
                    </TabsList>
                    <span className="text-xs text-muted-foreground font-mono">
                      Current Capacity: {pool.length} / {MAX_KEYS}
                    </span>
                  </div>

                  {/* Bulk Add Content */}
                  <TabsContent value="bulk" className="space-y-3 pt-1">
                    <Label htmlFor="bulk-keys" className="text-xs font-semibold text-foreground">
                      Paste Multiple Gemini API Keys
                    </Label>
                    <Textarea
                      id="bulk-keys"
                      rows={4}
                      placeholder={`AIzaSyA1234567890...\nAIzaSyB1234567890...\nAIzaSyC1234567890...\n\n(Paste up to 100 keys separated by newlines, commas, or spaces)`}
                      value={bulkInput}
                      onChange={(e) => setBulkInput(e.target.value)}
                      className="font-mono text-xs bg-background resize-y"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">
                        {detectedBulkKeys.length > 0 ? (
                          <strong className="text-emerald-700">
                            ✓ {detectedBulkKeys.length} valid key(s) detected in paste buffer
                          </strong>
                        ) : (
                          "Paste multiple keys from Google AI Studio. Duplicate keys will be filtered."
                        )}
                      </span>
                      <Button
                        size="sm"
                        disabled={detectedBulkKeys.length === 0 || pool.length >= MAX_KEYS}
                        onClick={handleAddBulkKeys}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                      >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add {detectedBulkKeys.length > 0 ? `${detectedBulkKeys.length} Keys` : "Keys"} to Pool
                      </Button>
                    </div>
                  </TabsContent>

                  {/* Single Key Content */}
                  <TabsContent value="single" className="space-y-3 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label htmlFor="single-key" className="text-xs font-semibold">
                          Gemini API Key
                        </Label>
                        <Input
                          id="single-key"
                          type="password"
                          placeholder="AIzaSy..."
                          value={singleKeyInput}
                          onChange={(e) => setSingleKeyInput(e.target.value)}
                          className="font-mono text-xs bg-background"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="single-label" className="text-xs font-semibold">
                          Label (Optional)
                        </Label>
                        <Input
                          id="single-label"
                          placeholder={`Key #${pool.length + 1}`}
                          value={singleLabelInput}
                          onChange={(e) => setSingleLabelInput(e.target.value)}
                          className="text-xs bg-background"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        disabled={!singleKeyInput.trim() || pool.length >= MAX_KEYS}
                        onClick={handleAddSingleKey}
                        className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                      >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add Key
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Pool Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBulkTesting || pool.length === 0}
                    onClick={handleTestAllKeys}
                    className="text-xs font-semibold border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                  >
                    {isBulkTesting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Testing {bulkTestProgress?.current}/{bulkTestProgress?.total}...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Test All {pool.length} Keys
                      </>
                    )}
                  </Button>

                  {invalidCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClearInvalidKeys}
                      className="text-xs font-semibold text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      Remove {invalidCount} Invalid Keys
                    </Button>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  Need more free keys?{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline font-semibold"
                  >
                    Google AI Studio ↗
                  </a>
                </div>
              </div>

              {/* Key Pool Table */}
              {pool.length === 0 ? (
                <div className="text-center py-10 border rounded-xl bg-card space-y-3">
                  <KeyRound className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">Key Pool is Empty</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Add up to 100 Google Gemini API keys using the bulk box above so the AI teacher runs uninterrupted on admin-managed servers.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-12 text-xs">#</TableHead>
                        <TableHead className="w-32 text-xs">Label</TableHead>
                        <TableHead className="text-xs">API Key</TableHead>
                        <TableHead className="w-32 text-xs">Status</TableHead>
                        <TableHead className="w-40 text-xs">Last Checked</TableHead>
                        <TableHead className="w-36 text-right text-xs">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pool.map((item, index) => {
                        const isRevealed = showKeyMap[item.id] || false;
                        const isTestingThis = testingKeyId === item.id;
                        const maskedKey = isRevealed
                          ? item.key
                          : `${item.key.slice(0, 7)}••••••••••••••••${item.key.slice(-4)}`;

                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell className="font-medium text-xs">
                              {item.label || `Key #${index + 1}`}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                <span className="break-all">{maskedKey}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => toggleShowKey(item.id)}
                                  title={isRevealed ? "Hide key" : "Show key"}
                                >
                                  {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => copyToClipboard(item.key, item.label || "API Key")}
                                  title="Copy key"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell>
                              {item.status === "active" ? (
                                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 text-[11px] gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Active
                                </Badge>
                              ) : item.status === "rate_limited" ? (
                                <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 text-[11px] gap-1">
                                  <AlertCircle className="h-3 w-3" /> Rate Ltd (429)
                                </Badge>
                              ) : item.status === "invalid" ? (
                                <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 text-[11px] gap-1">
                                  <XCircle className="h-3 w-3" /> Invalid
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                                  Untested
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {item.lastTestedAt ? (
                                <span>{new Date(item.lastTestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              ) : (
                                <span className="opacity-60">—</span>
                              )}
                              {item.lastErrorMessage && (
                                <p className="text-[10px] text-destructive truncate max-w-[150px]" title={item.lastErrorMessage}>
                                  {item.lastErrorMessage}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs px-2"
                                  disabled={isTestingThis || isBulkTesting}
                                  onClick={() => handleTestSingleKey(item)}
                                >
                                  {isTestingThis ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    "Test"
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleDeleteKey(item.id)}
                                  title="Delete key"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: PLAN PRICING MANAGEMENT */}
        <TabsContent value="pricing" className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee className="h-5 w-5 text-emerald-600" />
                <span>AI Teacher Subscription Plan Pricing</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Modify the one-time subscription prices for both plans. Changes immediately reflect across the Student Homepage Banner, Course Navigation, Paywall, and Razorpay checkout.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Plan 1: Plus Plan (BYOK) */}
                <div className="rounded-2xl border-2 border-border/80 bg-card p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-300 font-semibold text-xs">
                      Budget Friendly (BYOK)
                    </Badge>
                    <span className="p-2 rounded-xl bg-amber-100 text-amber-700">
                      <KeyRound className="h-4 w-4" />
                    </span>
                  </div>

                  <div>
                    <h3 className="font-bold text-base text-foreground">Plan 1: Plus Plan</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Student provides their own Google Gemini API key.
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label htmlFor="byok-price" className="text-xs font-semibold">
                      Plan Price (₹ INR)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-sm font-bold text-muted-foreground">
                        ₹
                      </span>
                      <Input
                        id="byok-price"
                        type="number"
                        min="0"
                        step="1"
                        value={local.plan_pricing?.byok_price ?? 500}
                        onChange={(e) =>
                          patchLocal({
                            plan_pricing: {
                              byok_price: Number(e.target.value),
                              admin_price: local.plan_pricing?.admin_price ?? 1000,
                            },
                          })
                        }
                        className="pl-7 font-bold text-base bg-background"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Default: ₹500</p>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Full 1-to-1 Voice & Chat Tutoring</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Zero server API consumption costs for admin</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Free Google AI Studio key walkthrough provided</span>
                    </div>
                  </div>
                </div>

                {/* Plan 2: Pro Plan (Admin Key) */}
                <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-b from-emerald-50/40 to-card p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-emerald-700 text-white font-semibold text-xs">
                      Admin Key Powered · Zero Setup
                    </Badge>
                    <span className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                      <Zap className="h-4 w-4" />
                    </span>
                  </div>

                  <div>
                    <h3 className="font-bold text-base text-foreground">Plan 2: Pro Plan</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Runs completely on SimpleLecture's managed 100-key pool.
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label htmlFor="admin-price" className="text-xs font-semibold">
                      Plan Price (₹ INR)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-sm font-bold text-emerald-700">
                        ₹
                      </span>
                      <Input
                        id="admin-price"
                        type="number"
                        min="0"
                        step="1"
                        value={local.plan_pricing?.admin_price ?? 1000}
                        onChange={(e) =>
                          patchLocal({
                            plan_pricing: {
                              byok_price: local.plan_pricing?.byok_price ?? 500,
                              admin_price: Number(e.target.value),
                            },
                          })
                        }
                        className="pl-7 font-bold text-base text-emerald-700 dark:text-emerald-400 bg-background"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Default: ₹1,000</p>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Works directly on SimpleLecture's 100-key pool</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Zero setup for student — 1-click learning access</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Automated failover if any key in pool hits limits</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveAll}
                  disabled={updateSettings.isPending}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                >
                  <Check className="h-4 w-4 mr-1.5" />
                  Save Updated Prices
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: VOICE & MODELS (SAME SETTINGS AS SITE SETTINGS) */}
        <TabsContent value="voice-models" className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                <span>AI Teacher Voice, Name & Persona Settings</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Configure default AI teacher behavior, live audio voice model, chat model, personality style, and language.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="live-model" className="text-xs font-semibold">
                    Voice (Live Audio) Model
                  </Label>
                  <Input
                    id="live-model"
                    value={local.live_model}
                    onChange={(e) => patchLocal({ live_model: e.target.value })}
                    className="font-mono text-xs bg-background"
                  />
                  <p className="text-[11px] text-muted-foreground">Default: gemini-3.8-live</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="chat-model" className="text-xs font-semibold">
                    Chat & Doubt-Solving Model
                  </Label>
                  <Input
                    id="chat-model"
                    value={local.chat_model}
                    onChange={(e) => patchLocal({ chat_model: e.target.value })}
                    className="font-mono text-xs bg-background"
                  />
                  <p className="text-[11px] text-muted-foreground">Default: gemini-3.1-flash-lite</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="teacher-voice" className="text-xs font-semibold">
                    Default Teacher Voice
                  </Label>
                  <Select
                    value={local.voice_name}
                    onValueChange={(voice_name) => patchLocal({ voice_name })}
                  >
                    <SelectTrigger id="teacher-voice" className="bg-background text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      {AI_TEACHER_VOICES.map((v) => (
                        <SelectItem key={v} value={v} className="text-xs">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Google Gemini Multimodal Live API Voice
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="teacher-name" className="text-xs font-semibold">
                    Default Teacher Name
                  </Label>
                  <Input
                    id="teacher-name"
                    value={local.teacher_name}
                    onChange={(e) => patchLocal({ teacher_name: e.target.value })}
                    placeholder="e.g. Asha Madam, Ravi Sir, AI Teacher"
                    className="text-xs bg-background"
                  />
                  <p className="text-[11px] text-muted-foreground">Used during voice conversations</p>
                </div>
              </div>

              {/* Personality Preset */}
              <div className="space-y-2 pt-2">
                <Label className="text-xs font-semibold">Default Personality Preset</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {AI_TEACHER_PERSONALITIES.map((p) => {
                    const active = (local.personality_preset || "friendly") === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => patchLocal({ personality_preset: p.id })}
                        className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                          active
                            ? "border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/40 ring-1 ring-emerald-600"
                            : "hover:bg-accent bg-card"
                        }`}
                      >
                        <span className="text-2xl leading-none">{p.emoji}</span>
                        <div>
                          <span className="block text-xs font-bold text-foreground">{p.label}</span>
                          <span className="block text-[11px] text-muted-foreground mt-0.5">{p.desc}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Instructions */}
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="custom-instructions" className="text-xs font-semibold">
                  Custom Admin Instructions for AI Teacher (Optional)
                </Label>
                <Textarea
                  id="custom-instructions"
                  rows={3}
                  value={local.custom_instructions || ""}
                  onChange={(e) => patchLocal({ custom_instructions: e.target.value })}
                  placeholder="e.g. Use Karnataka state board syllabus examples. Keep voice responses under 40 words. Cheer up students when solving tough maths problems."
                  className="text-xs bg-background resize-none"
                />
              </div>

              {/* Reply Language */}
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="reply-language" className="text-xs font-semibold">
                  Default Reply Language
                </Label>
                <Select
                  value={local.reply_language || "auto"}
                  onValueChange={(reply_language) => patchLocal({ reply_language })}
                >
                  <SelectTrigger id="reply-language" className="bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    {AI_TEACHER_LANGUAGES.map((l) => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSaveAll}
                  disabled={updateSettings.isPending}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                >
                  <Check className="h-4 w-4 mr-1.5" />
                  Save Voice & Models
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: SYSTEM DIAGNOSTIC */}
        <TabsContent value="diagnostic" className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="h-5 w-5 text-emerald-600" />
                <span>End-to-End System Diagnostic</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Tests server-side connectivity to Google Gemini, checks live audio model token creation, and validates chat model responsiveness.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="rounded-xl border p-4 bg-muted/20 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-foreground">Run Full Server Test</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Uses the primary key in pool: <code>{local.google_api_key ? `${local.google_api_key.slice(0, 8)}...` : "(No key set)"}</code>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={testAITeacher.isPending || !local.google_api_key}
                    onClick={() =>
                      testAITeacher.mutate({
                        google_api_key: local.google_api_key,
                        live_model: local.live_model,
                        chat_model: local.chat_model,
                      }, {
                        onError: (e) =>
                          toast({ title: "Diagnostic Failed", description: e.message, variant: "destructive" }),
                        onSuccess: () =>
                          toast({ title: "Diagnostic Complete", description: "Checked Chat, Live model and Token generation." }),
                      })
                    }
                    className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                  >
                    {testAITeacher.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Running Diagnostic...
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        Run Diagnostic Check
                      </>
                    )}
                  </Button>
                </div>

                {testAITeacher.data && (
                  <div className="space-y-2 rounded-xl border bg-card p-3 mt-3 text-xs">
                    <div className="flex items-center gap-2">
                      {testAITeacher.data.chatModel.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      )}
                      <span>
                        <strong>Chat Model ("{testAITeacher.data.chatModel.model}"):</strong>{" "}
                        {testAITeacher.data.chatModel.ok
                          ? "Online & Responding"
                          : testAITeacher.data.chatModel.message || "Failed"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {testAITeacher.data.liveModel.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      )}
                      <span>
                        <strong>Live Voice Model ("{testAITeacher.data.liveModel.model}"):</strong>{" "}
                        {testAITeacher.data.liveModel.ok
                          ? "Online & Responding"
                          : testAITeacher.data.liveModel.message || "Failed"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {testAITeacher.data.token.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      )}
                      <span>
                        <strong>Voice Session Token Generation:</strong>{" "}
                        {testAITeacher.data.token.ok
                          ? `Success (${testAITeacher.data.token.lockLevel}, ${testAITeacher.data.token.apiVersion})`
                          : testAITeacher.data.token.message || "Skipped / Failed"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
