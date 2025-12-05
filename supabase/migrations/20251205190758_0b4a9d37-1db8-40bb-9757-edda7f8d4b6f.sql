-- Fix PUBLIC_USER_DATA security issue: profiles table is publicly readable
-- Drop the insecure policy that allows anyone to read all profiles
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

-- Create a secure policy - users can only view their own profile
-- Super admins can still view all profiles via the existing "Super admins can view all profiles" policy
CREATE POLICY "Users can view own profile"
ON profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);