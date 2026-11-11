import { describe, it, expect } from "vitest";
import { splitInclusiveGST, applyPromoToInclusive, getCoursePriceBreakdown } from "./gst";

describe("splitInclusiveGST", () => {
  it("splits ₹2,950 into ₹2,500 base + ₹450 GST", () => {
    expect(splitInclusiveGST(2950)).toEqual({ total: 2950, base: 2500, gst: 450 });
  });

  it("base + gst always equals total", () => {
    for (const t of [1, 99, 999, 1000, 1999, 2950, 5000, 12345]) {
      const r = splitInclusiveGST(t);
      expect(r.base + r.gst).toBe(t);
    }
  });

  it("returns zeros for zero or invalid input", () => {
    expect(splitInclusiveGST(0)).toEqual({ total: 0, base: 0, gst: 0 });
    expect(splitInclusiveGST(-50)).toEqual({ total: 0, base: 0, gst: 0 });
    expect(splitInclusiveGST(NaN)).toEqual({ total: 0, base: 0, gst: 0 });
  });
});

describe("applyPromoToInclusive", () => {
  it("returns the price unchanged without a promo", () => {
    expect(applyPromoToInclusive(2950, null)).toBe(2950);
  });

  it("applies a percent discount to the inclusive total", () => {
    expect(applyPromoToInclusive(2950, { discount_percent: 10 })).toBe(2655);
  });

  it("applies a flat amount discount and never goes below zero", () => {
    expect(applyPromoToInclusive(2950, { discount_amount: 500 })).toBe(2450);
    expect(applyPromoToInclusive(2950, { discount_amount: 9999 })).toBe(0);
  });
});

describe("getCoursePriceBreakdown", () => {
  it("shows the full GST breakdown with no promo", () => {
    expect(getCoursePriceBreakdown(2950)).toEqual({
      original: 2950,
      discount: 0,
      total: 2950,
      base: 2500,
      gst: 450,
    });
  });

  it("recomputes base and GST from the discounted inclusive total", () => {
    // 10% off ₹2,950 = ₹2,655 inclusive → base ₹2,250 + GST ₹405
    const r = getCoursePriceBreakdown(2950, { discount_percent: 10 });
    expect(r.discount).toBe(295);
    expect(r.total).toBe(2655);
    expect(r.base + r.gst).toBe(2655);
    expect(r.gst).toBe(405);
  });
});
