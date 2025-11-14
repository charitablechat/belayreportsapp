-- Make the storage bucket public so images can be displayed
UPDATE storage.buckets 
SET public = true 
WHERE id = 'inspection-photos';

-- Allow anyone to read photos (so they display in the app)
CREATE POLICY "Public read access for inspection photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'inspection-photos');

-- Only authenticated users can upload
CREATE POLICY "Authenticated users can upload inspection photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inspection-photos');

-- Only owners can delete their photos
CREATE POLICY "Users can delete their own inspection photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'inspection-photos' AND auth.uid() = owner);