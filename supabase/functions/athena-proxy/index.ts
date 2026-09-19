// Generic proxy for the Athena AI API (http://116.202.230.124:8090).
// The browser cannot call it directly from the HTTPS preview (mixed content),
// so this function forwards the request server-side.
//
// Handles both JSON bodies and multipart/form-data (file uploads) correctly —
// multipart bodies are forwarded as raw bytes (never decoded through text())
// so binary file content (PDF/DOCX) isn't corrupted.
//
// Usage from the client:
//   GET  /functions/v1/athena-proxy?path=/subjects
//   POST /functions/v1/athena-proxy?path=/subjects&base=http://116.202.230.124:8090
//   POST /functions/v1/athena-proxy?path=/documents   (multipart/form-data body)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
};

const DEFAULT_BASE = 'http://116.202.230.124:8090';
// Allows a leading dot for file extensions (HyperFrame paths like
// /hf/seg_0/index.html and /hf/seg_0_female.mp3) — the original pattern
// rejected any path containing "." with a bare "Invalid path" 400.
const ALLOWED_PATH = /^\/[a-zA-Z0-9_\-\/.]*$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const rawPath = url.searchParams.get('path') || '/';
    const baseParam = url.searchParams.get('base') || DEFAULT_BASE;

    // Allow query string to be embedded inside the `path` param.
    const qIdx = rawPath.indexOf('?');
    const pathOnly = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
    const embeddedQuery = qIdx >= 0 ? rawPath.slice(qIdx + 1) : '';

    if (!ALLOWED_PATH.test(pathOnly)) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only allow http(s) base URLs
    let upstreamBase: URL;
    try {
      upstreamBase = new URL(baseParam);
      if (!/^https?:$/.test(upstreamBase.protocol)) throw new Error('bad proto');
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid base URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Merge any extra query params passed on the proxy URL itself (besides path/base).
    const extraParams = new URLSearchParams();
    for (const [k, v] of url.searchParams.entries()) {
      if (k !== 'path' && k !== 'base') extraParams.append(k, v);
    }
    const extraStr = extraParams.toString();
    const combinedQuery = [embeddedQuery, extraStr].filter(Boolean).join('&');
    const upstreamUrl = `${upstreamBase.origin}${pathOnly}${combinedQuery ? '?' + combinedQuery : ''}`;

    const method = req.method.toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const reqContentType = req.headers.get('content-type') || '';
    const isMultipart = reqContentType.toLowerCase().includes('multipart/form-data');

    // Multipart (file upload) bodies must be forwarded as raw bytes — reading
    // them through .text() corrupts binary file content. JSON/text bodies go
    // through .text() as before (keeps behaviour identical to ai-teaching-proxy).
    const body: BodyInit | undefined = hasBody
      ? (isMultipart ? await req.arrayBuffer() : await req.text())
      : undefined;

    const MAX_ATTEMPTS = method === 'GET' ? 2 : (isMultipart ? 1 : 3);
    let lastErr = 'Upstream fetch failed';
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      // Uploads/ingestion can take longer than a simple JSON call.
      const timeoutMs = isMultipart ? 600_000 : 420_000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const upstream = await fetch(upstreamUrl, {
          method,
          headers: { 'Content-Type': reqContentType || 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const upstreamCT = upstream.headers.get('content-type') || 'application/json';
        // Pass through SSE and binary media (HyperFrame audio) as a raw
        // stream — reading these through .text() would corrupt non-UTF8
        // bytes (silently breaking mp3 playback). JSON/HTML/text still go
        // through the buffered path below so retry-on-5xx keeps working.
        const isBinaryMedia = /^(audio|video|image)\//.test(upstreamCT) ||
          upstreamCT.includes('application/octet-stream');
        if (upstreamCT.includes('text/event-stream') || isBinaryMedia) {
          return new Response(upstream.body, {
            status: upstream.status,
            headers: { ...corsHeaders, 'Content-Type': upstreamCT },
          });
        }
        const text = await upstream.text();
        if (upstream.ok) {
          return new Response(text, {
            status: upstream.status,
            headers: { ...corsHeaders, 'Content-Type': upstreamCT },
          });
        }
        lastErr = text || `Upstream HTTP ${upstream.status}`;
        lastStatus = upstream.status;
        // Don't retry 4xx (client errors)
        if (upstream.status >= 400 && upstream.status < 500) {
          return new Response(text || JSON.stringify({ error: lastErr }), {
            status: upstream.status,
            headers: { ...corsHeaders, 'Content-Type': upstreamCT },
          });
        }
      } catch (err) {
        clearTimeout(timeoutId);
        lastErr = (err as Error)?.name === 'AbortError'
          ? `Upstream timed out after ${timeoutMs / 1000}s`
          : ((err as Error)?.message || 'Upstream fetch failed');
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }

    return new Response(
      JSON.stringify({ error: lastErr, status: lastStatus, upstream: upstreamUrl }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error)?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
