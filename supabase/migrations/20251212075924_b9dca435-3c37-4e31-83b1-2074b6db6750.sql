-- TEMPORARY FEATURE: Known Issues announcements table
-- Remove this table when the Known Issues feature is no longer needed
-- To remove: DROP TABLE public.app_announcements;

CREATE TABLE public.app_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_type text NOT NULL UNIQUE DEFAULT 'known_issues',
  content text NOT NULL DEFAULT '',
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.app_announcements ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read announcements
CREATE POLICY "Authenticated users can view announcements"
  ON public.app_announcements FOR SELECT
  TO authenticated
  USING (true);

-- Only super admins can update announcements
CREATE POLICY "Super admins can update announcements"
  ON public.app_announcements FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Only super admins can insert announcements
CREATE POLICY "Super admins can insert announcements"
  ON public.app_announcements FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());

-- Insert initial known_issues record
INSERT INTO public.app_announcements (announcement_type, content)
VALUES ('known_issues', '');