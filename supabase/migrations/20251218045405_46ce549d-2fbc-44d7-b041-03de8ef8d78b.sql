-- Fix: Restrict profile viewing to prevent data exposure
-- Drop the overly permissive policy if it exists
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Create restrictive policies:
-- 1. Users can view their own profile
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- 2. Super admins can view all profiles (needed for admin functionality)
CREATE POLICY "Super admins can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (is_super_admin());

-- 3. Users can view profiles of other users in their organization (for collaboration features)
CREATE POLICY "Users can view organization member profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM organization_members om1
    JOIN organization_members om2 ON om1.organization_id = om2.organization_id
    WHERE om1.user_id = auth.uid() AND om2.user_id = profiles.id
  )
);