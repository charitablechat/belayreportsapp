-- Allow super admins to update organizations
CREATE POLICY "Super admins can update organizations"
ON public.organizations
FOR UPDATE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Allow super admins to delete organizations
CREATE POLICY "Super admins can delete organizations"
ON public.organizations
FOR DELETE
USING (is_super_admin());

-- Allow super admins to insert organizations
CREATE POLICY "Super admins can insert organizations"
ON public.organizations
FOR INSERT
WITH CHECK (is_super_admin());