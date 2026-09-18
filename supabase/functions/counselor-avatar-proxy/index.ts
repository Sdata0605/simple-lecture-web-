// Generic proxy for the plain-HTTP Dynamic Avatar API (HeyGem/Chatterbox,
// admin default port 5004). The browser cannot call it directly from the
// HTTPS admin panel (mixed content), so this function forwards the request
// server-side. Same pattern as athena-proxy / ai-teaching-proxy.
//
// Handles both JSON bodies and multipart/form-data (avatar video/audio
// uploads) correctly — multipart bodies are forwarded as raw bytes (never
// decoded through text()) so binary file content isn't corrupted.
//
// NOTE: this proxy reads JSON/text responses through text() before
// returning them — fine for this API's JSON responses (health, queue,
// library/list, upload, generate, status), but NOT safe for raw binary
// responses (e.g. an actual video/audio file). The admin page only uses
// this proxy for the JSON endpoints; direct video/audio/download links
// stay as plain http:// anchors (full-page navigation isn't blocked by
// mixed-content policy the way fetch()/XHR are).
//
// Usage from the client:
//   GET  /functions/v1/counselor-avatar-proxy?path=/api/health
//   POST /functions/v1/counselor-avatar-proxy?path=/api/library/upload&base=http://204.12.237.78:5004

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
};

const DEFAULT_BASE = 'http://204.12.237.78:5004';
const ALLOWED_PATH = /^\/[a-zA-Z0-9_\-\/]*$/;

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

    // Multipart (avatar video/audio upload) bodies must be forwarded as raw
    // bytes — reading them through .text() corrupts binary file content.
    const body: BodyInit | undefined = hasBody
      ? (isMultipart ? await req.arrayBuffer() : await req.text())
      : undefined;

    const MAX_ATTEMPTS = method === 'GET' ? 2 : (isMultipart ? 1 : 3);
    let lastErr = 'Upstream fetch failed';
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      // Avatar generation can take a while; uploads longer still.
      const timeoutMs = isMultipart ? 300_000 : 60_000;
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
