-- Add ACCT# field to profiles table
ALTER TABLE public.profiles 
ADD COLUMN acct_number TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.acct_number IS 'Inspector ACCT certification number';