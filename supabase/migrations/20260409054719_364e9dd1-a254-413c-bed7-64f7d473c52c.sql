-- Admin policies for sync_conflicts table
CREATE POLICY "Admins can manage all sync conflicts"
ON public.sync_conflicts FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

-- Admin SELECT policy for report_deleted_items table
CREATE POLICY "Admins can view all deleted items"
ON public.report_deleted_items FOR SELECT TO authenticated
USING (is_admin_or_above());