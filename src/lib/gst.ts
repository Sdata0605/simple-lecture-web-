/**
 * GST helpers.
 *
 * Course prices (`courses.price_inr`) are stored as the FINAL, GST-inclusive
 * amount the student pays. The base price and GST are derived from it:
 *   base = round(total / 1.18)
 *   gst  = total - base
 * e.g. ₹2,950 → base ₹2,500 + GST ₹450 (18%).
 */

export const GST_RATE = 0.18;

export interface GstBreakdown {
  /** Inclusive total the student pays */
  total: number;
  /** Pre-GST amount */
  base: number;
  /** GST amount (18% of base) */
  gst: number;
}

export interface PromoLike {
  discount_percent?: number | null;
  discount_amount?: number | null;
}

/** Split a GST-inclusive amount into base + GST. */
export function splitInclusiveGST(total: number): GstBreakdown {
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const base = Math.round(safeTotal / (1 + GST_RATE));
  return { total: safeTotal, base, gst: safeTotal - base };
}

/**
 * Apply a promo to the GST-inclusive price.
 * Percent discounts are applied to the inclusive total; amount discounts are
 * subtracted from it. Result never goes below 0.
 */
export function applyPromoToInclusive(total: number, promo?: PromoLike | null): number {
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  if (!promo) return safeTotal;
  if (promo.discount_percent) {
    return Math.max(0, safeTotal - Math.round((safeTotal * promo.discount_percent) / 100));
  }
  if (promo.discount_amount) {
    return Math.max(0, safeTotal - promo.discount_amount);
  }
  return safeTotal;
}

/** Breakdown for a course price with an optional promo applied. */
export function getCoursePriceBreakdown(priceInclusive: number, promo?: PromoLike | null) {
  const original = Math.max(0, Math.round(Number(priceInclusive) || 0));
  const discounted = applyPromoToInclusive(original, promo);
  return {
    original,
    discount: original - discounted,
    ...splitInclusiveGST(discounted),
  };
}
