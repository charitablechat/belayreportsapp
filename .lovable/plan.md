# Narrow Fix — Duplicate Training Photo Uploads

## Root cause (verified, not assumed)

The `public.training_photos` table is the only photo table missing the unique-partial-index that `inspection_photos` and `daily_assessment_photos` already have. Live DB verification:

```text
inspection_photos        → idx_inspection_photos_no_duplicates
                           UNIQUE (inspection_id, photo_url, COALESCE(photo_section,'__null__'))
                           WHERE deleted_at IS NULL
daily_assessment_photos  → idx_daily_assessment_photos_no_duplicates  (same shape)
training_photos          → NONE  ← the gap
```

Both client paths that can insert a `training_photos` row pre-check for an existing row by `photo_url + training_id` and only insert if none is found:

- `PhotoCapture.uploadPhotoInBackground` (fast path, runs as soon as the file is captured online)
- `sync-manager` photo loop (background drain — also runs on reconnect / periodic / focus)

When the two paths race (e.g. the photo is captured online but the sync loop also wakes during the same tick, or a retry fires while the foreground insert is still in flight), both `maybeSingle()` SELECTs return empty, both INSERTs succeed, and **two `training_photos` rows are persisted with the same `photo_url`**. `PhotoGallery.loadPhotos` faithfully renders both rows — they fetch the same signed URL, so visually it looks like the same thumbnail twice. The current dedup in `PhotoGallery` (line 542–555) dedupes offline-vs-DB by `photo_url`, but does **not** dedupe DB rows against each other, because the DB layer is supposed to guarantee that.

This is the same pattern the existing memory `Photo Deduplication — unique index on photo_url + photo_section` describes; training was simply missed when that fix shipped for inspection / daily-assessment.

## Layer attribution
- **Not** UI rendering, blob caching, signed-URL caching, storage-path generation (each `photoId` is `{inspectionId}-{Date.now()}-{rand}` — collision-resistant), `OptimizedImage` cache key, or HEIC migrate logic.
- **Yes** DB row insertion: the race window between the two insert paths allows two rows for the same logical photo.

## Pre-migration safety
Live query proves the index can be created without conflict:

```sql
SELECT COUNT(*) FROM training_photos WHERE deleted_at IS NULL;            -- 40
SELECT training_id, photo_url, photo_section, COUNT(*)
  FROM training_photos WHERE deleted_at IS NULL
  GROUP BY 1,2,3 HAVING COUNT(*) > 1;                                     -- 0 rows
```

Zero existing duplicates → `CREATE UNIQUE INDEX` will succeed in one shot, no pre-dedup pass needed.

## Changes

### 1. DB migration (single statement)
`supabase/migrations/<timestamp>_training_photos_unique.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_photos_no_duplicates
  ON public.training_photos (training_id, photo_url, COALESCE(photo_section, '__null__'))
  WHERE deleted_at IS NULL;
```

Mirrors the existing inspection / daily-assessment indexes exactly. With the index in place, the losing INSERT in a race returns Postgres error code `23505`, which both client paths already treat as success-equivalent:
- `PhotoCapture.uploadPhotoInBackground` line 84: `if (... && !dbError.code?.includes('23505')) throw` → swallows duplicate.
- `sync-manager` line 693: `classifyPhotoError` returns `success-equivalent` for unique-violation → proceeds to `markPhotoAsUploaded`.

No client code changes required.

### 2. Tests
- `src/components/__tests__/photo-capture-duplicate-insert.test.ts` (new) — mock supabase so the first insert succeeds and the second returns a `23505` duplicate error; assert `uploadPhotoInBackground` does NOT throw and calls `markPhotoAsUploaded`.
- `src/components/__tests__/photo-gallery-dedup-by-path.test.ts` (new) — extract the offline-vs-DB dedup decision from `PhotoGallery.loadPhotos` into `src/components/photo-gallery-helpers.ts` as a pure `dedupeOfflineAgainstDb(offlineRows, dbStoragePaths, isTombstoned)` and assert: (a) offline row whose `rawStoragePath` matches a DB row is dropped; (b) offline row with empty path is kept; (c) tombstoned path is dropped regardless. Confirms two distinct selected files → two distinct gallery entries.
- A SQL-shape comment in the migration file documenting the pre-migration zero-duplicates check.

### 3. Memory update
Extend the existing `Photo Deduplication` memory note to record that `training_photos` now has the same unique partial index as `inspection_photos` and `daily_assessment_photos`.

## Out of scope (untouched)
Inspection photos, daily-assessment photos, storage bucket privacy, admin storage DELETE, signed-URL cache, HEIC migration, photo receipts, Zipline tombstones, service worker, Workbox, edge functions, training summary logic, generated-report cache trigger added in the previous fix, RLS.

## Validation
- Run full vitest suite; expect ≥1049 + ~3 new tests, zero regressions.
- Live DB re-query after migration confirms the new index exists.
- Manual checklist: upload one photo → one tile; upload two different files sequentially → two distinct tiles; offline capture + reconnect → one tile; reload form → same count; Generate Report → matches gallery.
