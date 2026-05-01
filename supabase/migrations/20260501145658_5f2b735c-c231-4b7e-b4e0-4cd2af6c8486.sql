CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role
  ON public.user_roles (user_id, role);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_org_role
  ON public.user_roles (user_id, organization_id, role)
  WHERE organization_id IS NOT NULL;