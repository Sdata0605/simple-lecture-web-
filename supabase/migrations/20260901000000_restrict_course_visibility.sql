ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS restricted_to_user_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "Public read courses" ON public.courses;
DROP POLICY IF EXISTS "Allow public read access to active courses" ON public.courses;
DROP POLICY IF EXISTS "Course visibility" ON public.courses;

CREATE POLICY "Course visibility"
ON public.courses
FOR SELECT
TO public
USING (
  is_active = true
  AND (
    restricted_to_user_id IS NULL
    OR restricted_to_user_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_courses_restricted_to_user_id
  ON public.courses(restricted_to_user_id)
  WHERE restricted_to_user_id IS NOT NULL;

UPDATE public.courses
SET restricted_to_user_id = '47a9b651-79d6-440b-a18c-9612ecf68b5a'
WHERE id = '8a445be4-0760-4f44-8dc3-b03220c6c83b';
