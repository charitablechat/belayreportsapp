-- M6: Unify photo bucket UPDATE policies to TO authenticated (was TO public)
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can update their own daily assessment photos" ON storage.objects;
CREATE POLICY "Users can update their own daily assessment photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'daily-assessment-photos' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'daily-assessment-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can update their own training photos" ON storage.objects;
CREATE POLICY "Users can update their own training photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'training-photos' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'training-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);