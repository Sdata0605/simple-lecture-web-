-- Expose offer and batch fields from the course detail RPC (course page).
-- Body is the same as 20260518090551 plus the new keys.

CREATE OR REPLACE FUNCTION public.get_course_detail(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'slug', c.slug,
    'description', c.description,
    'short_description', c.short_description,
    'detailed_description', c.detailed_description,
    'category', c.category,
    'thumbnail_url', c.thumbnail_url,
    'promotional_video_url', c.promotional_video_url,
    'price_inr', c.price_inr,
    'original_price_inr', c.original_price_inr,
    'regular_price_inr', c.regular_price_inr,
    'offer_active', c.offer_active,
    'offer_price_inr', c.offer_price_inr,
    'offer_content', c.offer_content,
    'batch_info', c.batch_info,
    'duration_months', c.duration_months,
    'rating', c.rating,
    'review_count', c.review_count,
    'student_count', c.student_count,
    'what_you_learn', c.what_you_learn,
    'course_includes', c.course_includes,
    'is_coming_soon', c.is_coming_soon,
    'ai_tutoring_enabled', c.ai_tutoring_enabled,
    'ai_tutoring_price', c.ai_tutoring_price,
    'live_classes_enabled', c.live_classes_enabled,
    'live_classes_price', c.live_classes_price,
    'language_topup_price', c.language_topup_price,
    'language_topup_original_price', c.language_topup_original_price,
    'available_languages', c.available_languages,
    'course_thumbnails', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('storage_url', ct.storage_url))
      FROM public.course_thumbnails ct WHERE ct.course_id = c.id
    ), '[]'::jsonb),
    'course_categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'categories', jsonb_build_object('id', cat.id, 'name', cat.name, 'slug', cat.slug)
      ))
      FROM public.course_categories cc
      JOIN public.categories cat ON cat.id = cc.category_id
      WHERE cc.course_id = c.id
    ), '[]'::jsonb),
    'course_subjects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'display_order', cs.display_order,
        'subject_id', cs.subject_id,
        'popular_subjects', jsonb_build_object(
          'id', ps.id,
          'name', ps.name,
          'slug', ps.slug,
          'description', ps.description,
          'thumbnail_url', ps.thumbnail_url
        )
      ) ORDER BY cs.display_order)
      FROM public.course_subjects cs
      JOIN public.popular_subjects ps ON ps.id = cs.subject_id
      WHERE cs.course_id = c.id
    ), '[]'::jsonb),
    'course_faqs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'question', f.question,
        'answer', f.answer,
        'display_order', f.display_order
      ) ORDER BY f.display_order)
      FROM public.course_faqs f WHERE f.course_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.courses c
  WHERE c.slug = p_slug AND c.is_active = true
  LIMIT 1;
$$;
