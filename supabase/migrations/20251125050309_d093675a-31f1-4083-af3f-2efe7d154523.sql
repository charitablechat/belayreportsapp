-- Add foreign key constraints from inspections and trainings to profiles
-- This allows Supabase client to properly join inspector data using relationship syntax

-- Add FK from inspections.inspector_id to profiles.id
ALTER TABLE public.inspections 
ADD CONSTRAINT inspections_inspector_id_profiles_fkey 
FOREIGN KEY (inspector_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;

-- Add FK from trainings.inspector_id to profiles.id
ALTER TABLE public.trainings 
ADD CONSTRAINT trainings_inspector_id_profiles_fkey 
FOREIGN KEY (inspector_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;