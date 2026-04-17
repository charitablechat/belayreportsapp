ALTER TABLE public.inspections       ADD COLUMN IF NOT EXISTS field_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.trainings         ADD COLUMN IF NOT EXISTS field_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.daily_assessments ADD COLUMN IF NOT EXISTS field_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.inspections.field_timestamps IS
  'Per-field updated_at map for cross-device merge. Keys = field name, values = ISO timestamps.';
COMMENT ON COLUMN public.trainings.field_timestamps IS
  'Per-field updated_at map for cross-device merge. Keys = field name, values = ISO timestamps.';
COMMENT ON COLUMN public.daily_assessments.field_timestamps IS
  'Per-field updated_at map for cross-device merge. Keys = field name, values = ISO timestamps.';