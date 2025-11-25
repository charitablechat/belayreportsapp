-- Add ACCT# field to inspections table
ALTER TABLE public.inspections 
ADD COLUMN acct_number TEXT;