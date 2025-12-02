-- Make organization_id nullable in user_roles to support global super_admin roles
ALTER TABLE public.user_roles 
ALTER COLUMN organization_id DROP NOT NULL;

-- Add comment explaining the nullable organization_id
COMMENT ON COLUMN public.user_roles.organization_id IS 
'Organization ID for role assignment. NULL for global roles like super_admin.';
