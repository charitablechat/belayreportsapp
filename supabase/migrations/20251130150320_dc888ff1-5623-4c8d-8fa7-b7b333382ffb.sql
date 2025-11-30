-- Make inspection-photos bucket private for enhanced security
UPDATE storage.buckets 
SET public = false 
WHERE id = 'inspection-photos';

-- Remove public read access policy
DROP POLICY IF EXISTS "Public read access for inspection photos" ON storage.objects;

-- Drop existing policies if they exist to recreate them properly
DROP POLICY IF EXISTS "Users can view their own inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own inspection photos" ON storage.objects;

-- Users can only access their own photos (organized by user_id folder structure)
CREATE POLICY "Users can view their own inspection photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can upload their own inspection photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'inspection-photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own inspection photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'inspection-photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);