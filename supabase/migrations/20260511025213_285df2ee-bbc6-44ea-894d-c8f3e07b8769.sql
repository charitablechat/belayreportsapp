-- Allow admins (not only true super_admin) to manage announcements.
-- True super_admin is read-only/invisible by design, so the old policy
-- silently blocked every Edit attempt from real admins.

DROP POLICY IF EXISTS "Super admins can update announcements" ON public.app_announcements;
DROP POLICY IF EXISTS "Super admins can insert announcements" ON public.app_announcements;

CREATE POLICY "Admins can update announcements"
  ON public.app_announcements FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY "Admins can insert announcements"
  ON public.app_announcements FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_above());