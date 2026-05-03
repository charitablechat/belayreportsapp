-- One-time backfill of inspection_photos.caption for item-photos whose caption
-- is empty or a generic placeholder. Derives the correct caption from the
-- parent inventory row by parsing the item UUID out of photo_url
-- (paths look like '<userId>/<inspectionId>/items/<itemId>.<ext>').
-- User-edited captions are NEVER overwritten.

WITH targets AS (
  SELECT
    p.id,
    p.photo_section,
    (regexp_match(p.photo_url, '/items/([0-9a-f-]{36})\.', 'i'))[1]::uuid AS item_id
  FROM public.inspection_photos p
  WHERE p.deleted_at IS NULL
    AND p.photo_url ~* '/items/[0-9a-f-]{36}\.'
    AND p.photo_section IN ('systems','equipment')
    AND (
      p.caption IS NULL
      OR btrim(p.caption) = ''
      OR p.caption = 'Item photo'
      OR p.caption = 'Photo'
      OR p.caption = p.photo_section
    )
),
resolved AS (
  SELECT
    t.id,
    COALESCE(
      NULLIF(btrim(s.name), ''),
      NULLIF(btrim(s.system_name), ''),
      NULLIF(btrim(z.zipline_name), ''),
      NULLIF(btrim(e.equipment_type), '')
    ) AS new_caption
  FROM targets t
  LEFT JOIN public.inspection_systems  s ON t.photo_section = 'systems'   AND s.id = t.item_id
  LEFT JOIN public.inspection_ziplines z ON t.photo_section = 'systems'   AND z.id = t.item_id
  LEFT JOIN public.inspection_equipment e ON t.photo_section = 'equipment' AND e.id = t.item_id
)
UPDATE public.inspection_photos p
SET caption = r.new_caption
FROM resolved r
WHERE p.id = r.id
  AND r.new_caption IS NOT NULL
  AND COALESCE(p.caption, '') IS DISTINCT FROM r.new_caption;