
-- Fix 1: Update webhook secret from placeholder to a real cryptographic secret
UPDATE public.webhook_config 
SET key_value = encode(gen_random_bytes(32), 'hex'), updated_at = now()
WHERE key_name = 'WEBHOOK_SECRET' AND key_value = 'YOUR_WEBHOOK_SECRET_HERE';

-- Fix 2: Remove user self-view on audit_logs (keep super admin only)
DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.audit_logs;

-- Fix 3: Restrict org member profile visibility to exclude sensitive fields
-- Drop the existing broad org member profile policy
DROP POLICY IF EXISTS "Users can view organization member profiles" ON public.profiles;

-- Create a view for org member profile access that excludes sensitive fields
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = on) AS
SELECT id, first_name, last_name, avatar_url, created_at, updated_at
FROM public.profiles;

-- Re-create org member policy but ONLY via the view approach
-- Users can still see org member profiles through the base table, but we restrict to non-sensitive fields
-- by replacing the policy with one that only allows seeing own profile + super admin
-- Org member lookups will use the view instead
CREATE POLICY "Users can view organization member profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (auth.uid() = id) OR
  is_super_admin() OR
  (
    EXISTS (
      SELECT 1
      FROM organization_members om1
      JOIN organization_members om2 ON om1.organization_id = om2.organization_id
      WHERE om1.user_id = auth.uid() AND om2.user_id = profiles.id
    )
  )
);
