-- Drop the existing public SELECT policies
DROP POLICY IF EXISTS "Anyone can view active form sections" ON public.form_sections;
DROP POLICY IF EXISTS "Anyone can view active form fields" ON public.form_fields;
DROP POLICY IF EXISTS "Anyone can view active field options" ON public.form_field_options;
DROP POLICY IF EXISTS "Anyone can view translations" ON public.form_translations;

-- Create new policies that require authentication
CREATE POLICY "Authenticated users can view form sections" 
ON public.form_sections 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view form fields" 
ON public.form_fields 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view field options" 
ON public.form_field_options 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view translations" 
ON public.form_translations 
FOR SELECT 
USING (auth.uid() IS NOT NULL);