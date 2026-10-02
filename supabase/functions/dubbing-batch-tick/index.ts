// Dubbing Batch Tick - server-driven pipeline runner for the admin Dubbing
// tab's "Auto Pipeline" feature. Invoked every minute by pg_cron (see the
// create_dubbing_batch_cron migration), independent of any admin browser
// tab being open. Reuses the existing auto_submission_runs table/claim RPC
// (see auto-submission-tick) with kind='dubbing_batch', but has its own
// copy of the per-item state machine since the dub_languages/dub_status
// API shape has no separate avatar/sanity-check phases — one "processing"
// state covers everything the external server does internally.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ItemStatus = "queued" | "processing" | "completed" | "stopped";

interface DubbedLanguageEntry {
  lang: string;
  video_path: string;
}

interface Item {
  topicId: string;
  topicTitle: string;
  chapterTitle?: string;
  videoJobId: string;
  externalJobId: string;
  documentName?: string | null;
  serverIp: string;
  status: ItemStatus;
  progressMessage?: string;
  errorMessage?: string;
  dubbedLanguages?: DubbedLanguageEntry[];
}

async function callProxy(body: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resp = await fetch(`${supabaseUrl}/functions/v1/video-generation-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  return { ok: resp.ok, data };
}

// deno-lint-ignore no-explicit-any
async function saveRun(supabase: any, runId: string, patch: Record<string, unknown>) {
  await supabase
    .from("auto_submission_runs")
    .update({ ...patch, last_tick_at: new Date().toISOString() })
    .eq("id", runId);
}

// deno-lint-ignore no-explicit-any
async function processRun(supabase: any, run: any) {
  // Same atomic claim the lecture/marketing pipeline uses — prevents a
  // concurrent cron tick (or manual nudge landing at the same moment) from
  // submitting the same item twice.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_auto_submission_run", {
    _run_id: run.id,
    _cooldown_seconds: 25,
  });
  if (claimError || claimed !== true) {
    if (claimError) console.error("[dubbing-batch-tick] claim failed", run.id, claimError);
    return;
  }

  const items: Item[] = Array.isArray(run.items) ? run.items : [];
  const idx: number = run.current_index ?? 0;
  if (idx >= items.length) {
    await saveRun(supabase, run.id, { status: "completed" });
    return;
  }
  const item = items[idx];
  const setItem = (patch: Partial<Item>) => {
    items[idx] = { ...items[idx], ...patch };
  };

  const cfg = (run.pipeline_config && typeof run.pipeline_config === "object") ? run.pipeline_config : {};
  const languages: string[] = Array.isArray(cfg.languages) ? cfg.languages : [];

  // QUEUED: trigger dub_languages for this item's video job.
  if (item.status === "queued") {
    try {
      const { ok, data } = await callProxy({
        action: "dub_languages",
        job_id: item.externalJobId,
        server_ip: item.serverIp,
        languages,
        speaker: cfg.speaker || "abhilash",
        tts_engine: cfg.tts_engine || "edgetts",
        ...(cfg.avatar_id ? { avatar_id: cfg.avatar_id } : {}),
        skip_avatar: !!cfg.skip_avatar,
        skip_section_merge: !!cfg.skip_section_merge,
        skip_final_merge: !!cfg.skip_final_merge,
      });
      const status = data?.status as string | undefined;
      if (!ok || (status && status !== "queued")) {
        throw new Error(data?.message || data?.error || "dub_languages request failed");
      }
      setItem({ status: "processing", progressMessage: "Dubbing started..." });
      await saveRun(supabase, run.id, { items });
    } catch (e) {
      setItem({ status: "stopped", errorMessage: `Submit failed: ${String((e as Error).message || e)}` });
      await saveRun(supabase, run.id, { items, status: "stopped" });
    }
    return;
  }

  // PROCESSING: poll dub_status.
  if (item.status === "processing") {
    const { ok, data } = await callProxy({
      action: "dub_status",
      job_id: item.externalJobId,
      server_ip: item.serverIp,
    });
    if (!ok || !data) {
      await saveRun(supabase, run.id, { items });
      return;
    }
    const details = data.details as Record<string, unknown> | undefined;
    const status = data.status as string | undefined;
    setItem({ progressMessage: (details?.progress as string) || item.progressMessage });

    if (status === "completed") {
      const { data: reviewData } = await callProxy({
        action: "review",
        job_id: item.externalJobId,
        server_ip: item.serverIp,
      });
      const dubbed = Array.isArray(reviewData?.dubbed_languages) ? reviewData.dubbed_languages : [];
      setItem({ status: "completed", dubbedLanguages: dubbed, progressMessage: "Dubbing complete" });
      const nextIdx = idx + 1;
      const isLast = nextIdx >= items.length;
      await saveRun(supabase, run.id, {
        items,
        current_index: nextIdx,
        status: isLast ? "completed" : "running",
      });
      return;
    }

    if (status === "failed") {
      const errMsg = (details?.error as string) || "Dubbing failed";
      setItem({ status: "stopped", errorMessage: errMsg });
      await saveRun(supabase, run.id, { items, status: "stopped" });
      return;
    }

    // Still processing — save progress and wait for the next tick.
    await saveRun(supabase, run.id, { items });
    return;
  }

  // Anything else at current_index (completed/stopped) — advance.
  if (item.status === "completed") {
    const nextIdx = idx + 1;
    const isLast = nextIdx >= items.length;
    await saveRun(supabase, run.id, {
      current_index: nextIdx,
      status: isLast ? "completed" : "running",
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: runs } = await supabase
      .from("auto_submission_runs")
      .select("*")
      .eq("status", "running")
      .eq("kind", "dubbing_batch");
    // deno-lint-ignore no-explicit-any
    const list = runs || [];
    await Promise.all(list.map((r: any) => processRun(supabase, r).catch((e: unknown) => {
      console.error("[dubbing-batch-tick] run", r.id, e);
    })));
    return new Response(JSON.stringify({ processed: list.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[dubbing-batch-tick] error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
