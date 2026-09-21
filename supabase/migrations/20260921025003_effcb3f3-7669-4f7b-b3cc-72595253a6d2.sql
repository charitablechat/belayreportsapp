DROP POLICY IF EXISTS "Admins can delete any jcf report" ON public.jcf_reports;

CREATE POLICY "Super admins can permanently delete jcf reports"
ON public.jcf_reports
FOR DELETE
TO authenticated
USING (public.is_super_admin());