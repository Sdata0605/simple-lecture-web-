// Client for Athena's /ask (SSE) and /answers/{id}/video (HyperFrame
// readiness poll) — the post-lecture "ask a question" feature. All requests
// go through athena-proxy (HTTPS -> Athena's plain-HTTP box), matching every
// other Athena caller in this app (useAthenaApi.ts, ImportSubjectToAthenaDialog).
//
// Verified live against the real server before writing this (2026-09-19):
// - SSE events are: thinking, meta (carries answer_id + hf_enabled), segment
//   (repeated, word-level timing + optional visual), done.
// - /answers/{id}/video: ready is null while generating, true with
//   html_paths/audio_female/audio_male once done, false if generation failed.
// - Those paths are relative to /storage/answers/{answerId}/{path} on the
//   Athena host — NOT documented anywhere; found by reading Athena's own
//   reference player (GET /frontend-static/player.js on the Athena server).
import { SUPABASE_DIRECT_URL } from "@/lib/supabaseUrl";

const ATHENA_BASE = "http://116.202.230.124:8090";
const PROXY_URL = `${SUPABASE_DIRECT_URL}/functions/v1/athena-proxy`;

function proxyUrl(path: string, extra?: Record<string, string>) {
  const search = new URLSearchParams({ path, base: ATHENA_BASE, ...extra });
  return `${PROXY_URL}?${search.toString()}`;
}

/** Full, fetchable URL for a HyperFrame html_paths/audio_* relative path. */
export function resolveHyperframeAssetUrl(answerId: string, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return proxyUrl(`/storage/answers/${answerId}/${clean}`);
}

export interface AthenaWordTiming {
  w: string;
  s: number;
  e: number;
}

export interface AthenaSegment {
  i: number;
  type?: string;
  title?: string;
  html?: string;
  plain?: string;
  t_start?: number;
  t_end?: number;
  tokens?: AthenaWordTiming[];
  cite?: number[];
  visual?: { renderer?: string; latex?: string };
}

export interface AthenaSource {
  document_id: string;
  title: string;
  section?: string;
}

export interface AthenaAskMeta {
  answer_id: string;
  hf_enabled: boolean;
  cached: boolean;
  sources: AthenaSource[];
}

export type AthenaAskEvent =
  | { type: "thinking" }
  | { type: "meta"; meta: AthenaAskMeta }
  | { type: "segment"; segment: AthenaSegment }
  | { type: "done"; answerId: string; sources: AthenaSource[] }
  | { type: "out_of_scope"; message?: string }
  | { type: "error"; message: string };

export interface AskAthenaParams {
  question: string;
  subjectId: string;
  chapterId?: string;
  topicId?: string;
  signal?: AbortSignal;
}

/**
 * Streams /ask, calling `onEvent` for each SSE message as it arrives.
 * Resolves once the stream ends (after `done`, `out_of_scope`, or a
 * connection close) — callers read final state from the events they
 * received, not from this function's return value.
 */
export async function askAthenaQuestion(
  params: AskAthenaParams,
  onEvent: (event: AthenaAskEvent) => void,
): Promise<void> {
  const response = await fetch(proxyUrl("/ask"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: params.question,
      subjectId: params.subjectId,
      chapterId: params.chapterId,
      topicId: params.topicId,
    }),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    onEvent({ type: "error", message: text || `Request failed (${response.status})` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (eventName: string, dataRaw: string) => {
    let data: any;
    try {
      data = dataRaw ? JSON.parse(dataRaw) : {};
    } catch {
      return;
    }
    switch (eventName) {
      case "thinking":
        onEvent({ type: "thinking" });
        break;
      case "meta":
        onEvent({
          type: "meta",
          meta: {
            answer_id: data.answer_id,
            hf_enabled: !!data.hf_enabled,
            cached: !!data.cached,
            sources: Array.isArray(data.sources) ? data.sources : [],
          },
        });
        break;
      case "segment":
        onEvent({ type: "segment", segment: data as AthenaSegment });
        break;
      case "done":
        onEvent({
          type: "done",
          answerId: data.answer_id,
          sources: Array.isArray(data.source_documents) ? data.source_documents : [],
        });
        break;
      case "out_of_scope":
        onEvent({ type: "out_of_scope", message: data.message });
        break;
      case "error":
        onEvent({ type: "error", message: data.message || data.error || "Unknown error" });
        break;
    }
  };

  // SSE frames are separated by a blank line; each frame has "event: x" and
  // "data: y" lines (comment lines starting with ":" — e.g. keep-alive pings
  // — are ignored).
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) dispatch(eventName, dataLines.join("\n"));
    }
  }
}

export interface HyperframeVideoStatus {
  ready: boolean | null;
  html_paths: string[];
  audio_female: string[];
  audio_male: string[];
}

export async function pollHyperframeVideo(answerId: string): Promise<HyperframeVideoStatus> {
  const res = await fetch(proxyUrl(`/answers/${encodeURIComponent(answerId)}/video`));
  if (!res.ok) throw new Error(`Video status request failed (${res.status})`);
  const data = await res.json();
  return {
    ready: data.ready ?? null,
    html_paths: Array.isArray(data.html_paths) ? data.html_paths : [],
    audio_female: Array.isArray(data.audio_female) ? data.audio_female : [],
    audio_male: Array.isArray(data.audio_male) ? data.audio_male : [],
  };
}
