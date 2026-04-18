-- App version policy: singleton row controlling minimum required client version
CREATE TABLE public.app_version_policy (
  id integer PRIMARY KEY DEFAULT 1,
  min_required_version text,
  recommended_version text,
  enforce_hard_reload boolean NOT NULL DEFAULT false,
  message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT singleton_check CHECK (id = 1)
);

ALTER TABLE public.app_version_policy ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read the policy (needed for enforcement on every client)
CREATE POLICY "Anyone authenticated can read version policy"
ON public.app_version_policy
FOR SELECT
TO authenticated
USING (true);

-- Only super admins can insert
CREATE POLICY "Super admins can insert version policy"
ON public.app_version_policy
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin());

-- Only super admins can update
CREATE POLICY "Super admins can update version policy"
ON public.app_version_policy
FOR UPDATE
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Seed singleton row with no enforcement
INSERT INTO public.app_version_policy (id, min_required_version, recommended_version, enforce_hard_reload)
VALUES (1, NULL, NULL, false)
ON CONFLICT (id) DO NOTHING;

-- Auto-update timestamp
CREATE TRIGGER update_app_version_policy_updated_at
BEFORE UPDATE ON public.app_version_policy
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();