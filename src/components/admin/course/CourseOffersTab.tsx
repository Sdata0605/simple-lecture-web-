import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Plus, Trash2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BATCH_ICONS, type BatchFeature, type BatchInfo, type OfferContent, type OfferText } from "@/lib/offers";
import { OfferBadge, OfferBanner, AboutTheBatch } from "@/components/offers/OfferComponents";

interface CourseOffersTabProps {
  courseId?: string;
  /** Raw course row as loaded by the admin form. */
  course: any;
  /** Regular (non-offer) GST-inclusive price, from the Pricing tab. */
  regularPrice: number;
  /** Called after a successful save so the parent form re-syncs. */
  onSaved?: () => void;
}

const EMPTY_CONTENT: OfferText = {
  label: "",
  banner_title: "",
  banner_subtitle: "",
  banner_cta: "",
};

export const CourseOffersTab = ({ courseId, course, regularPrice, onSaved }: CourseOffersTabProps) => {
  const queryClient = useQueryClient();
  const [basePrice, setBasePrice] = useState<number>(0);
  const [gstPercent, setGstPercent] = useState<number>(18);
  // Offer price (GST-inclusive) is always derived from base + GST %.
  const offerPrice = Math.round(basePrice * (1 + gstPercent / 100));
  const [content, setContent] = useState<OfferText>(EMPTY_CONTENT);
  const [batch, setBatch] = useState<BatchInfo>({ enabled: false, heading: "About the Batch", subjects: [], features: [] });
  const [subjectsText, setSubjectsText] = useState("");
  const [busy, setBusy] = useState(false);

  // Sync local state from the loaded course.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!course || seededFor.current === course.id) return;
    seededFor.current = course.id;
    const oc = (course.offer_content || {}) as OfferContent;
    const gst = Number(oc.gst_percent) > 0 ? Number(oc.gst_percent) : 18;
    const total = Number(course.offer_price_inr) || 0;
    setGstPercent(gst);
    setBasePrice(Number(oc.base_price_inr) > 0 ? Number(oc.base_price_inr) : Math.round(total / (1 + gst / 100)));
    const text = (course.offer_content || {}) as OfferContent;
    setContent({
      label: text.label || "",
      banner_title: text.banner_title || "",
      banner_subtitle: text.banner_subtitle || "",
      banner_cta: text.banner_cta || "",
    });
    const b: BatchInfo = course.batch_info || { enabled: false, heading: "About the Batch", subjects: [], features: [] };
    setBatch({ enabled: false, heading: "About the Batch", subjects: [], features: [], ...b });
    setSubjectsText((b.subjects || []).join(", "));
  }, [course]);

  const isLive = Boolean(course?.offer_active);
  const priceOk = offerPrice > 0 && regularPrice > 0 && offerPrice < regularPrice;

  const preview = useMemo(
    () => ({
      offer_active: true,
      slug: course?.slug,
      name: course?.name,
      offer_content: { ...content, base_price_inr: basePrice, gst_percent: gstPercent },
    }),
    [content, basePrice, gstPercent, course?.slug, course?.name],
  );

  const buildContentPayload = () => {
    const cleaned: OfferContent = {};
    (Object.keys(content) as (keyof OfferText)[]).forEach((k) => {
      const v = (content[k] || "").trim();
      if (v) cleaned[k] = v;
    });
    cleaned.base_price_inr = basePrice;
    cleaned.gst_percent = gstPercent;
    const subjects = subjectsText.split(",").map((s) => s.trim()).filter(Boolean);
    const features = (batch.features || []).filter((f) => f.title.trim());
    return {
      offer_content: cleaned,
      batch_info: { ...batch, subjects, features },
    };
  };

  const save = async (patch: Record<string, unknown>, successMessage: string) => {
    if (!courseId) return;
    setBusy(true);
    const { error } = await supabase.from("courses").update(patch as any).eq("id", courseId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(successMessage);
    queryClient.invalidateQueries({ queryKey: ["admin-course", courseId] });
    queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
    queryClient.invalidateQueries({ queryKey: ["live-offers"] });
    queryClient.invalidateQueries({ queryKey: ["program-detail"] });
    onSaved?.();
  };

  const startOffer = () => {
    if (!priceOk) {
      toast.error("Enter an offer price above 0 that is lower than the regular price.");
      return;
    }
    save({ offer_active: true, offer_price_inr: offerPrice, ...buildContentPayload() }, "Offer is live");
  };

  const stopOffer = () => save({ offer_active: false }, "Offer stopped. Regular price restored.");

  const saveDetails = () => {
    if (isLive && !priceOk) {
      toast.error("Offer price must be above 0 and lower than the regular price.");
      return;
    }
    save({ offer_price_inr: offerPrice || null, ...buildContentPayload() }, "Offer details saved");
  };

  const updateFeature = (index: number, patch: Partial<BatchFeature>) => {
    setBatch((b) => ({
      ...b,
      features: (b.features || []).map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  };

  const addFeature = () =>
    setBatch((b) => ({ ...b, features: [...(b.features || []), { icon: "sparkles", title: "" }] }));

  const removeFeature = (index: number) =>
    setBatch((b) => ({ ...b, features: (b.features || []).filter((_, i) => i !== index) }));

  if (!courseId) {
    return <p className="text-sm text-muted-foreground">Save the course first, then set up its offer.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Status and Start / Stop */}
      <Card className={isLive ? "border-primary/60 shadow-md" : ""}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-3">
                Exam Offer
                <Badge variant={isLive ? "default" : "secondary"}>{isLive ? "LIVE" : "OFF"}</Badge>
              </CardTitle>
              <CardDescription>
                While live, students see the offer price, the label, the banner and the animation for this course only.
                Stopping restores the regular price automatically.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={startOffer} disabled={busy || isLive} className="gap-2">
                <Play className="h-4 w-4" /> Start offer
              </Button>
              <Button onClick={stopOffer} disabled={busy || !isLive} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" /> Stop offer
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Regular price: <strong>₹{regularPrice.toLocaleString("en-IN")}</strong> (incl. GST) · Offer price:{" "}
            <strong>₹{offerPrice.toLocaleString("en-IN")}</strong> (₹{basePrice.toLocaleString("en-IN")} + {gstPercent}% GST)
            {offerPrice > 0 && regularPrice > 0 && (
              <span className="ml-2 text-muted-foreground">
                {offerPrice < regularPrice ? `saves ₹${(regularPrice - offerPrice).toLocaleString("en-IN")}` : "must be lower than regular price"}
              </span>
            )}
          </p>
          {course?.offer_started_at && isLive && (
            <p className="text-muted-foreground">Live since {new Date(course.offer_started_at).toLocaleString("en-IN")}</p>
          )}
        </CardContent>
      </Card>

      {/* Offer price */}
      <Card>
        <CardHeader>
          <CardTitle>Offer price</CardTitle>
          <CardDescription>
            Enter the base price before GST and the GST %. The student sees the base price, the GST % and the total.
            Example: ₹999 + 18% GST = ₹1,179.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="offer_base_price_inr">Base price (₹, before GST)</Label>
            <Input
              id="offer_base_price_inr"
              type="number"
              value={basePrice || ""}
              onChange={(e) => setBasePrice(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer_gst_percent">GST (%)</Label>
            <Input
              id="offer_gst_percent"
              type="number"
              min={0}
              max={100}
              value={gstPercent}
              onChange={(e) => setGstPercent(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>Total student pays (incl. GST)</Label>
            <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-lg font-bold">
              ₹{offerPrice.toLocaleString("en-IN")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Labels and banner text */}
      <Card>
        <CardHeader>
          <CardTitle>Labels and banner text</CardTitle>
          <CardDescription>Shown on course cards, the home banner and the course page. Leave a field empty to use the default.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="offer_label">Label (on cards)</Label>
            <Input id="offer_label" maxLength={40} placeholder="Exam Season Offer" value={content.label}
              onChange={(e) => setContent({ ...content, label: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer_banner_title">Banner headline</Label>
            <Input id="offer_banner_title" maxLength={80} placeholder="Exam Season Offer is LIVE" value={content.banner_title}
              onChange={(e) => setContent({ ...content, banner_title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer_banner_subtitle">Banner subtext</Label>
            <Textarea id="offer_banner_subtitle" maxLength={220} rows={2} value={content.banner_subtitle}
              onChange={(e) => setContent({ ...content, banner_subtitle: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer_banner_cta">Banner button text</Label>
            <Input id="offer_banner_cta" maxLength={40} placeholder="Enroll at the Offer Price" value={content.banner_cta}
              onChange={(e) => setContent({ ...content, banner_cta: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      {/* About the Batch */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>About the Batch</CardTitle>
              <CardDescription>Icon cards on the course page. Mark the key features to highlight them.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="batch_enabled">Show section</Label>
              <Switch id="batch_enabled" checked={Boolean(batch.enabled)}
                onCheckedChange={(v) => setBatch({ ...batch, enabled: v })} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch_heading">Section heading</Label>
              <Input id="batch_heading" value={batch.heading || ""} onChange={(e) => setBatch({ ...batch, heading: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch_validity">Course validity</Label>
              <Input id="batch_validity" placeholder="November 2026 to April 2027" value={batch.validity || ""}
                onChange={(e) => setBatch({ ...batch, validity: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch_subjects">Subjects (comma separated)</Label>
            <Input id="batch_subjects" value={subjectsText} onChange={(e) => setSubjectsText(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Features</Label>
            {(batch.features || []).map((f, i) => (
              <div key={i} className="grid grid-cols-[140px_1fr_auto_auto] items-center gap-2">
                <select
                  aria-label="Icon"
                  className="h-10 rounded-md border bg-background px-2 text-sm"
                  value={f.icon || "sparkles"}
                  onChange={(e) => updateFeature(i, { icon: e.target.value })}
                >
                  {Object.keys(BATCH_ICONS).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <Input aria-label="Feature text" maxLength={140} value={f.title}
                  onChange={(e) => updateFeature(i, { title: e.target.value })} />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={Boolean(f.highlight)}
                    onChange={(e) => updateFeature(i, { highlight: e.target.checked })} />
                  Key
                </label>
                <Button variant="ghost" size="icon" onClick={() => removeFeature(i)} aria-label="Remove feature">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addFeature} className="gap-2">
              <Plus className="h-4 w-4" /> Add feature
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveDetails} disabled={busy} className="gap-2">
          <Save className="h-4 w-4" /> Save offer details
        </Button>
      </div>

      {/* Live preview */}
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>How the offer looks when it is live. Nothing shows on the website until you press Start offer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <OfferBadge course={preview} />
          </div>
          <OfferBanner
            course={{
              ...preview,
              slug: course?.slug,
              price_inr: offerPrice,
              original_price_inr: regularPrice,
            }}
            to="#"
          />
          <AboutTheBatch batch={{ ...batch, enabled: true, subjects: subjectsText.split(",").map((s) => s.trim()).filter(Boolean) }} />
        </CardContent>
      </Card>
    </div>
  );
};
