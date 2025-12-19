-- Add super admin policies to training child tables

-- training_operating_systems
CREATE POLICY "Super admins can manage all training operating systems"
ON public.training_operating_systems FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- training_delivery_approaches
CREATE POLICY "Super admins can manage all training delivery approaches"
ON public.training_delivery_approaches FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- training_verifiable_items
CREATE POLICY "Super admins can manage all training verifiable items"
ON public.training_verifiable_items FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- training_immediate_attention
CREATE POLICY "Super admins can manage all training immediate attention"
ON public.training_immediate_attention FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- training_systems_in_place
CREATE POLICY "Super admins can manage all training systems in place"
ON public.training_systems_in_place FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- training_summary
CREATE POLICY "Super admins can manage all training summaries"
ON public.training_summary FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- training_photos (also missing super admin policy)
CREATE POLICY "Super admins can manage all training photos"
ON public.training_photos FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());