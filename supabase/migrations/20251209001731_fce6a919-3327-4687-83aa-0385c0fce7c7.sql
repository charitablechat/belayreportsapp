-- Add foreign key from inspections.inspector_id to profiles.id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'inspections_inspector_id_profiles_fkey'
    AND table_name = 'inspections'
  ) THEN
    ALTER TABLE public.inspections
    ADD CONSTRAINT inspections_inspector_id_profiles_fkey 
    FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add foreign key from trainings.inspector_id to profiles.id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'trainings_inspector_id_profiles_fkey'
    AND table_name = 'trainings'
  ) THEN
    ALTER TABLE public.trainings
    ADD CONSTRAINT trainings_inspector_id_profiles_fkey 
    FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add foreign key from daily_assessments.inspector_id to profiles.id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'daily_assessments_inspector_id_profiles_fkey'
    AND table_name = 'daily_assessments'
  ) THEN
    ALTER TABLE public.daily_assessments
    ADD CONSTRAINT daily_assessments_inspector_id_profiles_fkey 
    FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;