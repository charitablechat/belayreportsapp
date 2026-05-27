
WITH zero_byte_paths AS (
  SELECT name AS path
  FROM storage.objects
  WHERE bucket_id = 'inspection-photos'
    AND (metadata->>'size')::bigint = 0
)
UPDATE public.inspection_photos
SET deleted_at = NOW(),
    retention_until = NOW() + INTERVAL '60 days'
WHERE photo_url IN (SELECT path FROM zero_byte_paths)
  AND deleted_at IS NULL;

WITH zero_byte_paths AS (
  SELECT name AS path FROM storage.objects
  WHERE bucket_id = 'inspection-photos' AND (metadata->>'size')::bigint = 0
)
UPDATE public.inspection_systems SET photo_url = NULL
WHERE photo_url IN (SELECT path FROM zero_byte_paths);

WITH zero_byte_paths AS (
  SELECT name AS path FROM storage.objects
  WHERE bucket_id = 'inspection-photos' AND (metadata->>'size')::bigint = 0
)
UPDATE public.inspection_ziplines SET photo_url = NULL
WHERE photo_url IN (SELECT path FROM zero_byte_paths);

WITH zero_byte_paths AS (
  SELECT name AS path FROM storage.objects
  WHERE bucket_id = 'inspection-photos' AND (metadata->>'size')::bigint = 0
)
UPDATE public.inspection_equipment SET photo_url = NULL
WHERE photo_url IN (SELECT path FROM zero_byte_paths);
