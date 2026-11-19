import { Sparkles, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import "./offers.css";
import { useLiveOffers } from "@/hooks/useLiveOffers";
import {
  getBatchIcon,
  getOfferContent,
  getOfferPricing,
  isOfferLive,
  type BatchInfo,
  type OfferFields,
} from "@/lib/offers";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Price the big number shows: the base (pre-GST) price while a sale is live, otherwise the price as is. */
export function offerDisplayPrice(course: OfferFields | null | undefined, total: number): number {
  if (!isOfferLive(course) || total <= 0) return total;
  return getOfferPricing(course, total).base;
}

/** "₹999 + 18% GST" line shown under the offer price while an offer is live. */
export function OfferGstNote({ course, total }: { course: OfferFields | null | undefined; total: number }) {
  if (!isOfferLive(course) || total <= 0) return null;
  const p = getOfferPricing(course, total);
  return (
    <span className="block text-xs font-semibold opacity-90">
      {inr(p.base)} + {p.gst}% GST <span className="opacity-70">(incl. GST {inr(p.total)})</span>
    </span>
  );
}

/** Savings maths shared by the banner and price blocks. Null when there is no real discount. */
function getSavings(price: unknown, originalPrice: unknown) {
  const p = toNum(price);
  const o = toNum(originalPrice);
  if (p <= 0 || o <= p) return null;
  return { price: p, original: o, save: o - p, pct: Math.round(((o - p) / o) * 100) };
}

/** Bold gold pill shown on course cards and headers while an offer is live. */
export function OfferBadge({ course, className = "" }: { course: OfferFields | null | undefined; className?: string }) {
  if (!isOfferLive(course)) return null;
  const { label } = getOfferContent(course);
  const positioned = /(^|\s)!?(absolute|fixed|sticky)(\s|$)/.test(className);
  return (
    <span
      className={`${positioned ? "" : "relative"} offer-gold offer-shimmer offer-glow inline-flex items-center gap-1 rounded-full border border-white/60 px-3 py-1 text-xs font-extrabold uppercase tracking-wide shadow-lg ${className}`}
    >
      <Sparkles className="relative z-[2] h-3.5 w-3.5 shrink-0 fill-current" aria-hidden="true" />
      <span className="relative z-[2]">{label}</span>
    </span>
  );
}

/** Big banner for the home page and course page while an offer is live. */
export function OfferBanner({
  course,
  to,
  className = "",
  price,
  originalPrice,
}: {
  course:
    | (OfferFields & {
        name?: string;
        slug?: string;
        price_inr?: number | null;
        original_price_inr?: number | null;
      })
    | null
    | undefined;
  to?: string;
  className?: string;
  /** Offer price. Falls back to course.price_inr. */
  price?: number | null;
  /** Regular price. Falls back to course.original_price_inr. */
  originalPrice?: number | null;
}) {
  if (!isOfferLive(course)) return null;
  const content = getOfferContent(course);
  const href = to ?? (course?.slug ? `/course/${course.slug}` : "/programs");
  const savings = getSavings(price ?? course?.price_inr, originalPrice ?? course?.original_price_inr);
  return (
    <section
      aria-label={content.banner_title}
      className={`offer-banner offer-pop-in relative isolate overflow-hidden rounded-2xl ${className}`}
    >
      <div className="offer-shine pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />

      {/* Gold ribbon */}
      <div className="offer-stripes relative z-[1] flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-widest sm:px-8 sm:text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          {content.label}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          Limited time
        </span>
      </div>

      <div className="relative z-[1] flex flex-col gap-4 p-4 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-widest text-white">
            <span className="relative flex h-2.5 w-2.5">
              <span className="offer-ping absolute inline-flex h-full w-full rounded-full" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            Live now
          </span>
          <h2 className="break-words text-2xl font-black leading-tight tracking-tight sm:text-4xl">
            {content.banner_title}
          </h2>
          {content.banner_subtitle && (
            <p className="max-w-2xl text-sm text-white/90 sm:text-base">{content.banner_subtitle}</p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:shrink-0">
          {savings && (
            <div className="rounded-xl border border-white/20 bg-black/25 px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="offer-gold-text text-3xl font-black leading-none sm:text-4xl">{inr(offerDisplayPrice(course, savings.price))}</span>
                <span className="text-base text-white/70 line-through">{inr(savings.original)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold">
                <span className="offer-gold rounded-md px-2 py-0.5 uppercase">Save {inr(savings.save)}</span>
                <span className="rounded-md bg-white/15 px-2 py-0.5 text-white">{savings.pct}% OFF</span>
              </div>
              <div className="mt-1 text-white">
                <OfferGstNote course={course} total={savings.price} />
              </div>
            </div>
          )}
          <Link
            to={href}
            className="offer-gold offer-glow inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-extrabold shadow-lg transition-transform motion-safe:hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            <span className="offer-bounce inline-flex items-center gap-2">
              {content.banner_cta}
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Large offer price block for course pages while an offer is live.
 * `tone="dark"` is for use on the green hero, `tone="light"` on cards/sidebars.
 */
export function OfferPrice({
  price,
  originalPrice,
  tone = "light",
  align = "start",
  className = "",
  course,
}: {
  price: number | null | undefined;
  originalPrice?: number | null;
  tone?: "light" | "dark";
  align?: "start" | "center";
  className?: string;
  /** Course whose offer is live; adds the "base + GST" line. */
  course?: OfferFields | null;
}) {
  const s = getSavings(price, originalPrice);
  if (!s) return null;
  const center = align === "center";
  return (
    <div className={`space-y-1 ${center ? "text-center" : ""} ${className}`}>
      <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${center ? "justify-center" : ""}`}>
        <span className={`text-4xl font-black leading-none ${tone === "dark" ? "offer-gold-text" : "text-primary"}`}>
          {inr(offerDisplayPrice(course, s.price))}
        </span>
        <span className={`text-lg line-through ${tone === "dark" ? "text-white/70" : "text-muted-foreground"}`}>
          {inr(s.original)}
        </span>
      </div>
      <div className={`flex flex-wrap items-center gap-1.5 text-xs font-bold ${center ? "justify-center" : ""}`}>
        <span className="offer-gold rounded-md px-2 py-0.5 text-sm uppercase">Save {inr(s.save)}</span>
        <span className={`rounded-md px-2 py-0.5 ${tone === "dark" ? "bg-white/15 text-white" : "bg-success text-white"}`}>
          {s.pct}% OFF
        </span>
      </div>
      <div className={`${tone === "dark" ? "text-white" : "text-foreground"} ${center ? "text-center" : ""}`}>
        <OfferGstNote course={course} total={s.price} />
      </div>
    </div>
  );
}

/** "About the Batch" section. Shown only when the course has batch info enabled. */
export function AboutTheBatch({ batch }: { batch: BatchInfo | null | undefined }) {
  if (!batch?.enabled) return null;
  const features = batch.features ?? [];
  const subjects = batch.subjects ?? [];
  return (
    <section aria-labelledby="about-the-batch" className="space-y-5">
      <div className="space-y-1">
        <h2 id="about-the-batch" className="text-2xl font-bold">
          {batch.heading || "About the Batch"}
        </h2>
        {batch.validity && (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Course validity:</span> {batch.validity}
          </p>
        )}
      </div>

      {subjects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {subjects.map((s, i) => (
            <span key={`${s}-${i}`} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
              {s}
            </span>
          ))}
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {features.map((f, i) => {
          const Icon = getBatchIcon(f.icon);
          return (
            <li
              key={`${f.title}-${i}`}
              className={`flex items-start gap-3 rounded-xl border p-4 transition motion-safe:hover:-translate-y-0.5 hover:shadow-md ${
                f.highlight ? "offer-card-ring bg-primary/5" : "bg-card"
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${f.highlight ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{f.title}</p>
                {f.highlight && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Key feature
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Price line used on course cards: shows the current price, with the strikethrough only when there is a real discount. */
export function CardPrice({
  price,
  originalPrice,
  size = "lg",
  offerLive = false,
  offer,
}: {
  price: number;
  originalPrice?: number | null;
  size?: "lg" | "md";
  /** When true and there is a real discount, the price is enlarged and a "Save ₹X" line is shown. */
  offerLive?: boolean;
  /** Course offer fields, used for the "base + GST" line. */
  offer?: OfferFields | null;
}) {
  const hasDiscount = Boolean(originalPrice && originalPrice > price);
  if (offerLive && hasDiscount) {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          <span className={`${size === "lg" ? "text-4xl" : "text-3xl"} font-black leading-none text-primary`}>
            {inr(offerDisplayPrice(offer ?? { offer_active: true }, price))}
          </span>
          <span className="text-lg line-through text-muted-foreground">{inr(originalPrice!)}</span>
        </span>
        <span className="offer-gold w-fit rounded-md px-2 py-0.5 text-xs font-extrabold uppercase">
          Save {inr(originalPrice! - price)}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">
          <OfferGstNote course={offer ?? { offer_active: true }} total={price} />
        </span>
      </span>
    );
  }
  return (
    <>
      <span className={`${size === "lg" ? "text-3xl" : "text-2xl"} font-bold text-primary`}>
        ₹{price.toLocaleString("en-IN")}
      </span>
      {hasDiscount && (
        <span className="text-lg line-through text-muted-foreground">₹{originalPrice!.toLocaleString("en-IN")}</span>
      )}
    </>
  );
}

/** "% OFF" pill; renders nothing when there is no real discount. */
export function DiscountBadge({
  price,
  originalPrice,
  offerLive = false,
}: {
  price: number;
  originalPrice?: number | null;
  /** When true, renders a larger red sale tag instead of the small green pill. */
  offerLive?: boolean;
}) {
  if (!originalPrice || originalPrice <= price) return null;
  const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
  if (offerLive) {
    return (
      <span className="rounded-md bg-red-600 px-2.5 py-1 text-sm font-black uppercase tracking-wide text-white shadow-md">
        {pct}% OFF
      </span>
    );
  }
  return <span className="rounded-md bg-success px-2 py-0.5 text-xs font-bold text-white">{pct}% OFF</span>;
}

/** Home-page banner: shows the first live offer, nothing when no offer is live. */
export function HomeOfferBanner({ className = "" }: { className?: string }) {
  const { data } = useLiveOffers();
  const live = data?.[0];
  if (!live) return null;
  return (
    <div className={`container mx-auto px-4 pb-8 ${className}`}>
      <OfferBanner course={live} />
    </div>
  );
}
