-- Add RLS policies for super admins to manage all inspections
CREATE POLICY "Super admins can insert all inspections"
  ON public.inspections FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admins can update all inspections"
  ON public.inspections FOR UPDATE
  TO authenticated
  USING (public.is_super_admin());

CREATE POLICY "Super admins can delete all inspections"
  ON public.inspections FOR DELETE
  TO authenticated
  USING (public.is_super_admin());