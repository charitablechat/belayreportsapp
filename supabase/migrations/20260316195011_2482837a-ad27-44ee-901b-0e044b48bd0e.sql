
-- Add owner-based SELECT policies for all three photo storage buckets
-- This allows photo uploaders to read their own photos (path pattern: {user_id}/...)

-- 1. inspection-photos: owner SELECT
CREATE POLICY "Owners can view their own inspection photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 2. training-photos: owner SELECT
CREATE POLICY "Owners can view their own training photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'training-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 3. daily-assessment-photos: owner SELECT
CREATE POLICY "Owners can view their own daily assessment photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'daily-assessment-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
