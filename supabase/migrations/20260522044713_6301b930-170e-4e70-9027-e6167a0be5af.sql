-- Ensure a single training_summary row per training so upsert(..., {onConflict:'training_id'}) works.
-- No duplicates currently exist (verified pre-migration), but we still de-dupe defensively (keep oldest by created_at, then by id).
WITH ranked AS (
  SELECT id, training_id,
         ROW_NUMBER() OVER (PARTITION BY training_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.training_summary
)
DELETE FROM public.training_summary t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS training_summary_training_id_key
  ON public.training_summary (training_id);