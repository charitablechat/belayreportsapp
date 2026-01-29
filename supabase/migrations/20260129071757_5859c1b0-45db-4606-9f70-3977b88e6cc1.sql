-- Fix overly permissive RLS policies on global_field_history table
-- Replace "true" with authenticated user check

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Authenticated users can insert global history" ON public.global_field_history;
DROP POLICY IF EXISTS "Authenticated users can update global history" ON public.global_field_history;

-- Create properly scoped INSERT policy (any authenticated user can insert)
CREATE POLICY "Authenticated users can insert global history" 
ON public.global_field_history 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- Create properly scoped UPDATE policy (any authenticated user can update)
CREATE POLICY "Authenticated users can update global history" 
ON public.global_field_history 
FOR UPDATE 
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);