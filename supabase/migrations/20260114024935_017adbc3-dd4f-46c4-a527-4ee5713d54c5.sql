-- Fix storage exposure: Make contact-attachments bucket private
-- The super admin policy already exists, just need to update bucket privacy and remove public policy

-- Step 1: Update bucket to be private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'contact-attachments';

-- Step 2: Drop the public SELECT policy if it exists
DROP POLICY IF EXISTS "Public can view contact attachments" ON storage.objects;