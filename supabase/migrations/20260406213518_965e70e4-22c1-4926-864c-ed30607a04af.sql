-- Add missing UPDATE policies for training-photos and daily-assessment-photos storage buckets
-- These allow photo owners to update/replace their own photos (e.g., re-upload converted JPEG)

CREATE POLICY "Users can update their own training photos"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'training-photos' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'training-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own daily assessment photos"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'daily-assessment-photos' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'daily-assessment-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Add missing super admin INSERT and DELETE on inspection_photos table
-- (Super admins already have SELECT and UPDATE but are missing INSERT/DELETE)
CREATE POLICY "Super admins can insert inspection photos"
ON public.inspection_photos FOR INSERT
TO public
WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection photos"
ON public.inspection_photos FOR DELETE
TO public
USING (is_super_admin());

-- Add missing super admin manage-all policy on inspection-photos storage bucket
CREATE POLICY "Super admins can manage all inspection photos storage"
ON storage.objects FOR ALL
TO public
USING (bucket_id = 'inspection-photos' AND is_super_admin())
WITH CHECK (bucket_id = 'inspection-photos' AND is_super_admin());