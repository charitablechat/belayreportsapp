
-- Create admin_settings table
CREATE TABLE public.admin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

-- Enable RLS
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Super admin only policies
CREATE POLICY "Super admins can view admin settings"
ON public.admin_settings FOR SELECT
USING (is_super_admin());

CREATE POLICY "Super admins can insert admin settings"
ON public.admin_settings FOR INSERT
WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update admin settings"
ON public.admin_settings FOR UPDATE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Seed the reset timestamp
INSERT INTO public.admin_settings (key, value) VALUES ('avg_completion_time_reset_at', '1970-01-01T00:00:00Z');
