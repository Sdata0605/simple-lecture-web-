-- Exam-season offers and "About the Batch" content, per course.
--
-- Model:
--   regular_price_inr          normal GST-inclusive price (admin edits this)
--   offer_active               admin Start/Stop switch
--   offer_price_inr            GST-inclusive offer price used while live
--   offer_content              label / banner text (admin editable)
--   batch_info                 "About the Batch" content (admin editable)
--   price_inr                  the CURRENT price every screen, cart and the
--                              payment function already read. A trigger keeps
--                              it in sync: offer price while live, regular
--                              price otherwise.
--   original_price_inr         strikethrough price. While live it is the regular
--                              price; on Stop the previous value is restored.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS regular_price_inr integer,
  ADD COLUMN IF NOT EXISTS offer_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offer_price_inr integer,
  ADD COLUMN IF NOT EXISTS offer_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_saved_original_inr integer,
  ADD COLUMN IF NOT EXISTS offer_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS batch_info jsonb;

-- Existing courses: regular price = current price, no offer running.
UPDATE public.courses
SET regular_price_inr = price_inr
WHERE regular_price_inr IS NULL;

CREATE OR REPLACE FUNCTION public.apply_course_offer_pricing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  was_live boolean := (TG_OP = 'UPDATE' AND OLD.offer_active IS TRUE);
BEGIN
  IF NEW.regular_price_inr IS NULL THEN
    NEW.regular_price_inr := NEW.price_inr;
  END IF;

  IF NEW.offer_active IS TRUE AND coalesce(NEW.offer_price_inr, 0) > 0 THEN
    IF NEW.offer_price_inr >= NEW.regular_price_inr THEN
      RAISE EXCEPTION 'offer price (%) must be below the regular price (%)', NEW.offer_price_inr, NEW.regular_price_inr;
    END IF;
    IF NOT was_live THEN
      -- Offer is starting: remember the strikethrough value to restore on Stop.
      NEW.offer_saved_original_inr := NEW.original_price_inr;
      NEW.offer_started_at := now();
    END IF;
    NEW.price_inr := NEW.offer_price_inr;
    NEW.original_price_inr := NEW.regular_price_inr;
  ELSE
    -- A direct write to price_inr alone (SQL editor, scripts) is treated as a regular-price change.
    IF TG_OP = 'UPDATE' AND NEW.price_inr IS DISTINCT FROM OLD.price_inr
       AND NEW.regular_price_inr IS NOT DISTINCT FROM OLD.regular_price_inr THEN
      NEW.regular_price_inr := NEW.price_inr;
    END IF;
    IF was_live THEN
      -- Offer is stopping: restore the previous strikethrough value.
      NEW.original_price_inr := NEW.offer_saved_original_inr;
      NEW.offer_saved_original_inr := NULL;
      NEW.offer_started_at := NULL;
    END IF;
    NEW.offer_active := false;
    NEW.price_inr := NEW.regular_price_inr;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS courses_apply_offer_pricing ON public.courses;
CREATE TRIGGER courses_apply_offer_pricing
BEFORE INSERT OR UPDATE ON public.courses
FOR EACH ROW
EXECUTE FUNCTION public.apply_course_offer_pricing();

ALTER TABLE public.courses
  DROP CONSTRAINT IF EXISTS courses_offer_price_positive,
  ADD CONSTRAINT courses_offer_price_positive CHECK (offer_price_inr IS NULL OR offer_price_inr > 0);

-- Seed: Class 10 (SSLC - Karnataka). Client asked for ₹999 excl. GST, so the
-- GST-inclusive offer price is ₹999 × 1.18 = ₹1,179 (splits back into ₹999 + ₹180 GST).
UPDATE public.courses
SET
  offer_price_inr = 1179,
  offer_content = '{
    "label": "Exam Season Offer",
    "banner_title": "Exam Season Offer is LIVE",
    "banner_subtitle": "Class 10 Karnataka SSLC complete course at a special price. Valid November 2026 to April 2027.",
    "banner_cta": "Enroll at the Offer Price"
  }'::jsonb,
  batch_info = '{
    "enabled": true,
    "heading": "About the Batch",
    "validity": "November 2026 to April 2027",
    "subjects": ["Mathematics", "Science", "Social Science"],
    "features": [
      {"icon": "book-open", "title": "Complete Karnataka SSLC Board Syllabus Coverage"},
      {"icon": "bot", "title": "24/7 AI-Powered Personal Tutor", "highlight": true},
      {"icon": "messages-square", "title": "One-to-One Interactive Learning Sessions with Our AI Tutor", "highlight": true},
      {"icon": "lightbulb", "title": "Instant Doubt Solving and Personalised Explanations"},
      {"icon": "file-text", "title": "Model Question Papers"},
      {"icon": "clipboard-check", "title": "Mock Tests"},
      {"icon": "target", "title": "Daily Practice Problems (DPPs)"},
      {"icon": "play", "title": "Free Demo Chapters"}
    ]
  }'::jsonb
WHERE slug = 'class-10-sslc-karnataka'
  AND offer_content = '{}'::jsonb
  AND batch_info IS NULL;
