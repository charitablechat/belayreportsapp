-- Add SELECT-only storage policy so regular admins can read inspection-photos
-- objects. Original-owner and super-admin policies remain unchanged. No upload,
-- update, or delete policies are altered.
CREATE POLICY "Admins can view all inspection photos storage"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND public.is_admin_or_above()
);