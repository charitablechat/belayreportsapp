## What the video shows

In the inspection form, item rows (Operating Systems, Ziplines, Equipment) each have a small camera control that uploads a photo and inserts a row into the corresponding `*_photos` gallery table with a `caption`. Later, the same photo appears under "Photos – Systems & Ziplines" but with a label that doesn't match the row's current name — e.g. a shed/cargo-bay photo captioned **"Cargo Net"** sitting next to a row currently named **"Multiline"**, and similar mismatches across Platform 1/2/7/8 rows.

## Root cause

In `src/components/inspection/ItemPhotoUpload.tsx`:

1. The caption is captured **once at upload time** from the `itemName` prop:
   - `caption: itemName || 'Item photo'` is sent into both `inspection_photos` (line ~189) and `savePhotoOffline` (line ~275).
2. After that, the caption is **never refreshed**. If the user:
   - Took the photo *before* typing a name (so `itemName` was empty → caption stored as "Item photo" or stale auto-name), or
   - Renamed the row later (e.g. typed "Multiline" over what used to be "Cargo Net"), or
   - Reordered/edited rows so the same row now displays a different name,
   …the gallery still shows the original caption because `inspection_photos.caption` is frozen.
3. `PhotoGallery.tsx` renders `photo.caption` from the DB row directly (line 324, 949, 1051), with no fallback to the parent row's current name.

There's no link from `inspection_photos` back to the parent `inspection_systems` / `inspection_ziplines` / `inspection_equipment` row beyond the shared storage `photo_url`, so we can't currently re-derive the caption at read time without help.

## Fix

Do three things, in this order:

### 1. Keep the caption in sync when the item is renamed (`ItemPhotoUpload.tsx`)

Add an effect that, when `itemName` changes *and* `photoUrl` exists, updates the matching row in the gallery table:
- Match on `inspection_id = inspectionId AND photo_url = photoUrl AND photo_section = photoSection`.
- Set `caption = <new itemName>` (debounce ~600 ms to avoid a write per keystroke).
- Also update the IDB-cached photo record's `caption` via a small new helper in `offline-storage.ts` so offline gallery views match.
- No-op when `itemName` is empty/whitespace, when offline (the next online sync will carry the latest name — see step 3), or when the row is still on a temp/offline `photo_url`.

### 2. Use the freshest `itemName` at capture time (`ItemPhotoUpload.tsx`)

Hold `itemName` in a ref (`itemNameRef.current = itemName`) and read from the ref inside `handleUpload` / `uploadInBackground` so a photo captured during typing still picks up the latest value rather than the value bound when the callback was memoized.

### 3. Server-side fallback at insert time (`sync-manager.ts`, ~line 482)

When the offline-queued photo finally syncs and `inspection_photos` is inserted, if the queued `caption` is empty or one of the generic placeholders (`'Item photo'`, `'equipment'`, `'systems'`, `photoSection`), look up the current parent row name (`inspection_systems.name` / `inspection_ziplines.zipline_name` / `inspection_equipment.equipment_type`) using the IDs we already track on the photo record (`itemId` is encoded in the deterministic `photoId = item-<itemId>-<ts>` and in `pending/<inspectionId>/items/<itemId>.jpg`). Use that as the caption. This ensures any photos already in the queue with stale captions get the right label on first successful sync.

### 4. One-time backfill for already-mismatched DB rows (migration)

Add a SQL migration that re-derives captions for existing rows where the current caption is empty, equals the section name, or equals "Item photo":
- For `inspection_photos`, parse the `item-<uuid>-...` segment out of `photo_url` (paths look like `<userId>/<inspectionId>/items/<itemId>.jpg`) and join to the matching `inspection_systems` / `inspection_ziplines` / `inspection_equipment` row to copy its current name into `caption`. Only updates rows where the caption is currently generic — never overwrites a user-edited caption.

## Files touched

- `src/components/inspection/ItemPhotoUpload.tsx` — sync-on-rename effect + freshest-name ref
- `src/lib/offline-storage.ts` — small `updatePhotoCaption(photoId, caption)` helper
- `src/lib/sync-manager.ts` — caption fallback when inserting into `*_photos`
- `supabase/migrations/<new>.sql` — one-time caption backfill for the three gallery tables

## Verification

1. Take a photo on a row before typing the name → type the name → photo appears in the gallery with the correct name (within ~1s).
2. Rename an existing row that already has a photo → gallery caption updates after the debounce.
3. Take a photo offline before naming → name the row → go online → the synced gallery row inserts with the correct caption (step 3).
4. After deploy, run the migration and confirm that the existing "Cargo Net"/"Platform 1"/etc. mismatches in the user's report now show the correct row names. User-edited captions are untouched.
