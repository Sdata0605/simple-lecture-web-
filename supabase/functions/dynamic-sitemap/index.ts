import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

// The sitemap is public, read-only GET content, so the wildcard origin is kept as-is.
// Do not add more permissive headers here.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = "https://simplelecture.com";

// Public, non-auth-gated routes from src/App.tsx. Static pages get no lastmod
// because they have no stable modification date.
// Auth-gated paths must not be added here (/reels is gated inside MobileReels, so it is excluded).
const STATIC_PAGES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/programs", changefreq: "weekly", priority: "0.9" },
  { path: "/forum", changefreq: "daily", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.7" },
  { path: "/contact", changefreq: "monthly", priority: "0.6" },
  { path: "/support", changefreq: "monthly", priority: "0.6" },
  { path: "/privacy", changefreq: "monthly", priority: "0.4" },
  { path: "/terms", changefreq: "monthly", priority: "0.4" },
  { path: "/blog", changefreq: "weekly", priority: "0.7" },
  { path: "/how-it-works", changefreq: "monthly", priority: "0.6" },
  { path: "/success-stories", changefreq: "monthly", priority: "0.6" },
];

// Programmatic SEO landing pages (/learn/:slug).
// Source of truth: src/lib/seo/landingPages.ts (LANDING_PAGES[].slug).
// The edge function cannot import from the frontend, so keep this list in sync by hand.
const LANDING_SLUGS = [
  "jee-main-online-coaching",
  "neet-2026-online-coaching",
  "class-12-physics-online-classes",
  "class-11-physics-online-classes",
  "physics-online-classes",
  "online-coaching-india",
];

// PostgREST caps a single response at 1000 rows.
const PAGE_SIZE = 1000;

// Reads every row of a query by paging with .range().
// build() must return a fresh query with a deterministic .order() so pages do not overlap.
// Any query error is thrown so the caller can return 503 instead of a partial sitemap.
async function fetchAll(
  build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// Escapes the five XML special characters so slugs cannot break the document.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Converts a timestamp to a YYYY-MM-DD date. Returns null when missing so lastmod is omitted.
function dateOnly(value: string | null | undefined): string | null {
  return value ? String(value).split("T")[0] : null;
}

function url(
  loc: string,
  lastmod: string | null,
  changefreq: string,
  priority: string
): string {
  // Apache redirects folder URLs without the slash, so every page location must end with "/"
  // (the homepage already does). Keep in sync with src/lib/seo/canonical.ts.
  const pageLoc = loc.endsWith("/") || /\.(png|jpe?g|gif|webp|avif|svg|ico|xml|txt|json|js|css|pdf|webmanifest)$/i.test(loc) ? loc : loc + "/";
  const lastmodTag = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${escapeXml(pageLoc)}</loc>${lastmodTag}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function unavailable(): Response {
  return new Response("Sitemap temporarily unavailable. Please retry later.", {
    status: 503,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "300",
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    // courses has no updated_at column (only created_at), so its lastmod is omitted.
    // popular_subjects and explore_by_goal have updated_at, which is used for lastmod.
    // blog_posts has no updated_at column (only published_at and created_at), so its lastmod is omitted.
    const [courses, subjects, posts, goals] = await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from("courses")
          .select("slug")
          .eq("is_active", true)
          .order("sequence_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("popular_subjects")
          .select("slug, updated_at")
          .eq("is_active", true)
          .order("slug", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("blog_posts")
          .select("slug")
          .eq("status", "published")
          .order("slug", { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from("explore_by_goal")
          .select("slug, updated_at")
          .eq("is_active", true)
          .order("slug", { ascending: true })
          .range(from, to)
      ),
    ]);

    const staticUrls = STATIC_PAGES.map((p) =>
      url(`${BASE_URL}${p.path}`, null, p.changefreq, p.priority)
    ).join("\n");

    const landingUrls = LANDING_SLUGS.map((slug) =>
      url(`${BASE_URL}/learn/${slug}`, null, "weekly", "0.85")
    ).join("\n");

    const courseUrls = courses
      .filter((c) => c.slug)
      .map((c) => url(`${BASE_URL}/course/${c.slug}`, null, "weekly", "0.8"))
      .join("\n");

    const subjectUrls = subjects
      .filter((s) => s.slug)
      .map((s) => url(`${BASE_URL}/subject/${s.slug}`, dateOnly(s.updated_at), "weekly", "0.75"))
      .join("\n");

    const blogUrls = posts
      .filter((p) => p.slug)
      .map((p) => url(`${BASE_URL}/blog/${p.slug}`, null, "monthly", "0.6"))
      .join("\n");

    const goalUrls = goals
      .filter((g) => g.slug)
      .map((g) => url(`${BASE_URL}/explore/${g.slug}`, dateOnly(g.updated_at), "weekly", "0.7"))
      .join("\n");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}
${landingUrls}
${courseUrls}
${subjectUrls}
${goalUrls}
${blogUrls}
</urlset>`;

    return new Response(sitemap, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Sitemap generation error:", err);
    return unavailable();
  }
});
