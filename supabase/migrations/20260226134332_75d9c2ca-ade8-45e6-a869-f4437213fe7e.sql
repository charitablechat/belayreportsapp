
-- Super admins can read ALL cloud backup snapshots (for the All User Snapshots panel)
CREATE POLICY "Super admins can view all cloud backups"
ON public.report_cloud_backups
FOR SELECT
TO authenticated
USING (is_super_admin());
