ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trainer';

INSERT INTO public.user_roles (user_id, role, organization_id)
SELECT p.id, 'inspector'::app_role, NULL
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
)
ON CONFLICT DO NOTHING;