-- Pre-migration safety check (live-verified at plan time):
--   SELECT COUNT(*) FROM training_photos WHERE deleted_at IS NULL;  -> 40
--   SELECT training_id, photo_url, photo_section, COUNT(*)
--     FROM training_photos WHERE deleted_at IS NULL
--     GROUP BY 1,2,3 HAVING COUNT(*) > 1;                            -> 0 rows
-- Zero existing duplicates, safe to create UNIQUE INDEX in one shot.
--
-- Mirrors idx_inspection_photos_no_duplicates and
-- idx_daily_assessment_photos_no_duplicates. Closes the insert race
-- between PhotoCapture.uploadPhotoInBackground (foreground fast path)
-- and sync-manager photo loop (background drain). The losing INSERT
-- returns 23505, which both client paths already swallow as
-- success-equivalent (PhotoCapture line 84, sync-manager via
-- classifyPhotoError).
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_photos_no_duplicates
  ON public.training_photos (training_id, photo_url, COALESCE(photo_section, '__null__'))
  WHERE deleted_at IS NULL;