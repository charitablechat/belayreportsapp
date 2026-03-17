
-- Add facility column to report_cloud_backups
ALTER TABLE public.report_cloud_backups ADD COLUMN IF NOT EXISTS facility text DEFAULT '';

-- Backfill existing rows from snapshot_data
UPDATE public.report_cloud_backups
SET facility = COALESCE(
  snapshot_data->'parent'->>'organization',
  snapshot_data->'parent'->>'site',
  ''
)
WHERE facility = '' OR facility IS NULL;
