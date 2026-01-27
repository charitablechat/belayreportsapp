-- Fix: Ensure inspection-photos bucket is private and public policy is removed
-- The secure policies already exist, we just need to ensure bucket is private

-- Step 1: Make the bucket private (no anonymous access)
UPDATE storage.buckets 
SET public = false 
WHERE id = 'inspection-photos';

-- Step 2: Drop the overly permissive public read policy if it exists
DROP POLICY IF EXISTS "Public read access for inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view inspection photos" ON storage.objects;