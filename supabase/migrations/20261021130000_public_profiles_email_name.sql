-- ISS-003: when a student has no full name, show the part of their login email before the @
-- (never the domain). Only that part is added to the public view; the email itself is not exposed.

CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT
    id,
    full_name,
    avatar_url,
    split_part(email, '@', 1) AS email_name
  FROM public.profiles;

-- The grant to anon and authenticated from 20261021120000 is kept by CREATE OR REPLACE.
