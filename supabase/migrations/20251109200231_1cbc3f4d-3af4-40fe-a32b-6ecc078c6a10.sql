-- Create helper function to check if user is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'super_admin'
  )
$$;

-- Add super admin policies for organizations
CREATE POLICY "Super admins can view all organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Add super admin policies for organization_members
CREATE POLICY "Super admins can view all memberships"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Add super admin policies for user_roles
CREATE POLICY "Super admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Add super admin policies for inspections
CREATE POLICY "Super admins can view all inspections"
  ON public.inspections FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Add super admin policies for notifications_log (UPDATE - don't duplicate)
CREATE POLICY "Super admins can view all notifications"
  ON public.notifications_log FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Add super admin policies for sync_conflicts
CREATE POLICY "Super admins can view all conflicts"
  ON public.sync_conflicts FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

-- Add super admin policies for push_subscriptions
CREATE POLICY "Super admins can view all subscriptions"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (public.is_super_admin());