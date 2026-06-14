-- JCF storage RLS policies (mirror training-photos pattern)
DROP POLICY IF EXISTS "Users can upload own jcf photos" ON storage.objects;
CREATE POLICY "Users can upload own jcf photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'jcf-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can read own jcf photos" ON storage.objects;
CREATE POLICY "Users can read own jcf photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'jcf-photos'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.is_admin_or_above()
  )
);

DROP POLICY IF EXISTS "Users can update own jcf photos" ON storage.objects;
CREATE POLICY "Users can update own jcf photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'jcf-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete own jcf photos" ON storage.objects;
CREATE POLICY "Users can delete own jcf photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'jcf-photos'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.is_admin_or_above()
  )
);