
-- Retroactive cleanup: soft-delete duplicate photo rows across all photo tables.
-- For each group sharing the same (inspection_id/assessment_id, photo_url, photo_section)
-- where deleted_at IS NULL, keep only the earliest created_at row and soft-delete the rest.

-- 1. inspection_photos
WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY inspection_id, photo_url, COALESCE(photo_section, '__null__')
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.inspection_photos
  WHERE deleted_at IS NULL
)
UPDATE public.inspection_photos
SET deleted_at = now(),
    retention_until = now() + INTERVAL '60 days'
WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- 2. daily_assessment_photos
WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY assessment_id, photo_url, COALESCE(photo_section, '__null__')
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.daily_assessment_photos
  WHERE deleted_at IS NULL
)
UPDATE public.daily_assessment_photos
SET deleted_at = now(),
    retention_until = now() + INTERVAL '60 days'
WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- 3. Add a unique index to prevent future duplicates on inspection_photos
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspection_photos_no_duplicates
ON public.inspection_photos (inspection_id, photo_url, COALESCE(photo_section, '__null__'))
WHERE deleted_at IS NULL;

-- 4. Add a unique index to prevent future duplicates on daily_assessment_photos
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_assessment_photos_no_duplicates
ON public.daily_assessment_photos (assessment_id, photo_url, COALESCE(photo_section, '__null__'))
WHERE deleted_at IS NULL;
