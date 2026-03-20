
-- Add missing UPDATE policy for inspection-photos bucket (required for upsert: true)
CREATE POLICY "Users can update their own inspection photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'inspection-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Remove overly permissive INSERT policy (no folder ownership check)
DROP POLICY IF EXISTS "Authenticated users can upload inspection photos" ON storage.objects;
