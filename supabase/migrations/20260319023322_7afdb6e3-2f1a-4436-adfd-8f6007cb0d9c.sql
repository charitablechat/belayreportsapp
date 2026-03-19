-- Add is_active column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Change inspector_id FKs from CASCADE to SET NULL
ALTER TABLE public.inspections DROP CONSTRAINT inspections_inspector_id_profiles_fkey;
ALTER TABLE public.inspections ADD CONSTRAINT inspections_inspector_id_profiles_fkey 
  FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.trainings DROP CONSTRAINT trainings_inspector_id_profiles_fkey;
ALTER TABLE public.trainings ADD CONSTRAINT trainings_inspector_id_profiles_fkey 
  FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.daily_assessments DROP CONSTRAINT daily_assessments_inspector_id_profiles_fkey;
ALTER TABLE public.daily_assessments ADD CONSTRAINT daily_assessments_inspector_id_profiles_fkey 
  FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Change last_modified_by FKs to SET NULL as well
ALTER TABLE public.inspections DROP CONSTRAINT inspections_last_modified_by_fkey;
ALTER TABLE public.inspections ADD CONSTRAINT inspections_last_modified_by_fkey 
  FOREIGN KEY (last_modified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.trainings DROP CONSTRAINT trainings_last_modified_by_fkey;
ALTER TABLE public.trainings ADD CONSTRAINT trainings_last_modified_by_fkey 
  FOREIGN KEY (last_modified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.daily_assessments DROP CONSTRAINT daily_assessments_last_modified_by_fkey;
ALTER TABLE public.daily_assessments ADD CONSTRAINT daily_assessments_last_modified_by_fkey 
  FOREIGN KEY (last_modified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Make inspector_id nullable on all report tables (required for SET NULL to work)
ALTER TABLE public.inspections ALTER COLUMN inspector_id DROP NOT NULL;
ALTER TABLE public.trainings ALTER COLUMN inspector_id DROP NOT NULL;
ALTER TABLE public.daily_assessments ALTER COLUMN inspector_id DROP NOT NULL;