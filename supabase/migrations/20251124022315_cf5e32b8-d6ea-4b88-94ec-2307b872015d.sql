-- Create a public bucket for PDF templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdf-templates', 'pdf-templates', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public read access for PDF templates" ON storage.objects;
DROP POLICY IF EXISTS "Super admins can upload PDF templates" ON storage.objects;

-- Create RLS policy to allow public read access
CREATE POLICY "Public read access for PDF templates"
ON storage.objects FOR SELECT
USING (bucket_id = 'pdf-templates');

-- Create RLS policy to allow authenticated users to upload templates (for super admins)
CREATE POLICY "Super admins can upload PDF templates"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pdf-templates' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'super_admin'
  )
);