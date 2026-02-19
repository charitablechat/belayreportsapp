
ALTER TABLE public.inspections ADD COLUMN active_duration_seconds integer DEFAULT 0;
ALTER TABLE public.trainings ADD COLUMN active_duration_seconds integer DEFAULT 0;
ALTER TABLE public.daily_assessments ADD COLUMN active_duration_seconds integer DEFAULT 0;
