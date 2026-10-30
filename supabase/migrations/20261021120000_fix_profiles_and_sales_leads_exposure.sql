-- ISS-002 / ISS-002b: stop students reading other users' profiles and all sales leads.
--
-- Stage 1 (additive, safe to run first): public_profiles view + admin/teacher read access.
-- Stage 2 (removes the leaks): run only after the app uses public_profiles and passes tests.
--
-- The live project had two policies that are not in any earlier migration:
--   "Public profiles are viewable by authenticated users"  (profiles, SELECT, true)
--   "Allow users to read sales leads"                      (sales_leads, SELECT, true, anon + authenticated)

-- ---------- Stage 1 ----------

-- Only the fields that other users may see (names and avatars in forums and group chat).
-- The view runs with the owner's rights, so it returns these three columns for every user,
-- while the profiles table itself stays protected by RLS.
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, full_name, avatar_url
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- Admin and teacher dashboards read whole profile rows (user lists, orders, student details).
CREATE POLICY "Admins and teachers view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'teacher'::app_role)
  );

-- ---------- Stage 2 (run after the app tests pass) ----------

DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;

DROP POLICY IF EXISTS "Allow users to read sales leads" ON public.sales_leads;

-- A student can read only their own lead (the AI Teacher plan check looks it up by login email).
CREATE POLICY "Users view own sales leads"
  ON public.sales_leads FOR SELECT
  TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'));
