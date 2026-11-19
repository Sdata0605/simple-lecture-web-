import {
  BookOpen,
  Bot,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Layers,
  Lightbulb,
  MessagesSquare,
  Play,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Exam-season offers (per course).
 *
 * The database trigger `apply_course_offer_pricing` keeps `price_inr` equal to
 * the offer price while an offer is live, and `original_price_inr` equal to the
 * regular price. Screens can therefore keep showing `price_inr` /
 * `original_price_inr` as before. These helpers only decide whether the offer
 * decoration (labels, banners, animation) should appear.
 */

/** Columns every course query must select so the offer decoration can render. */
export const OFFER_SELECT_FIELDS = "offer_active, offer_content";

export interface OfferContent {
  label?: string;
  banner_title?: string;
  banner_subtitle?: string;
  banner_cta?: string;
  /** Offer price before GST (admin enters this). */
  base_price_inr?: number;
  /** GST percentage applied to base_price_inr. */
  gst_percent?: number;
}

export const DEFAULT_GST_PERCENT = 18;

/**
 * Base price + GST breakdown of the live offer price.
 * total = courses.price_inr (already the offer price while live).
 * Uses the admin's base and GST % when stored; otherwise derives them from total.
 */
export function getOfferPricing(course: OfferFields | null | undefined, total: number) {
  const c = (course?.offer_content ?? {}) as OfferContent;
  const gst = Number(c.gst_percent) > 0 ? Number(c.gst_percent) : DEFAULT_GST_PERCENT;
  const base = Number(c.base_price_inr) > 0
    ? Number(c.base_price_inr)
    : Math.round(total / (1 + gst / 100));
  return { total, base, gst, gstAmount: total - base };
}

export interface OfferFields {
  offer_active?: boolean | null;
  /** Stored as jsonb; typed loosely because generated Supabase types use Json. */
  offer_content?: unknown;
}

export function isOfferLive(course: OfferFields | null | undefined): boolean {
  return Boolean(course?.offer_active);
}

export type OfferText = Required<Pick<OfferContent, "label" | "banner_title" | "banner_subtitle" | "banner_cta">>;

export function getOfferContent(course: OfferFields | null | undefined): OfferText {
  const c = (course?.offer_content ?? {}) as OfferContent;
  return {
    label: c.label || "Exam Season Offer",
    banner_title: c.banner_title || "Exam Season Offer is LIVE",
    banner_subtitle: c.banner_subtitle || "Limited-time price for a limited period.",
    banner_cta: c.banner_cta || "Enroll Now",
  };
}

/** Icon names the admin can pick for "About the Batch" features. */
export const BATCH_ICONS: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  bot: Bot,
  "messages-square": MessagesSquare,
  lightbulb: Lightbulb,
  "file-text": FileText,
  "clipboard-check": ClipboardCheck,
  target: Target,
  play: Play,
  calendar: CalendarDays,
  "graduation-cap": GraduationCap,
  sparkles: Sparkles,
  users: Users,
  layers: Layers,
};

export interface BatchFeature {
  icon?: string;
  title: string;
  highlight?: boolean;
}

export interface BatchInfo {
  enabled?: boolean;
  heading?: string;
  validity?: string;
  subjects?: string[];
  features?: BatchFeature[];
}

export function getBatchIcon(name?: string): LucideIcon {
  return (name && BATCH_ICONS[name]) || Sparkles;
}
