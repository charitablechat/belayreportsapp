ALTER TABLE public.inspections       ADD COLUMN IF NOT EXISTS user_cleared_at timestamptz;
ALTER TABLE public.trainings         ADD COLUMN IF NOT EXISTS user_cleared_at timestamptz;
ALTER TABLE public.daily_assessments ADD COLUMN IF NOT EXISTS user_cleared_at timestamptz;