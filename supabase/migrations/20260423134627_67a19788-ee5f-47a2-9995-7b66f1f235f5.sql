ALTER TABLE public.inspections      ADD COLUMN IF NOT EXISTS client_idempotency_key text;
ALTER TABLE public.trainings        ADD COLUMN IF NOT EXISTS client_idempotency_key text;
ALTER TABLE public.daily_assessments ADD COLUMN IF NOT EXISTS client_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS inspections_client_idemp_unique
  ON public.inspections (inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS trainings_client_idemp_unique
  ON public.trainings (inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS daily_assessments_client_idemp_unique
  ON public.daily_assessments (inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;