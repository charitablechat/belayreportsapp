

# Protect Photos from Data Loss

## Problem Found

The equipment photo for the Druidia report was never persisted to the server database. It only existed in IndexedDB (local browser storage) and was lost when the cache expired or the device changed. The database confirms zero photos exist with `photo_section = 'equipment'` for this report.

Additionally, the `inspection_photos` table has **no soft-delete protection** -- unlike reports (which have `deleted_at` and 60-day retention), photos are permanently deleted with no recovery path.

## Root Causes

1. **No soft-delete on photo tables**: `inspection_photos`, `training_photos`, and `daily_assessment_photos` lack `deleted_at`/`retention_until` columns, so any delete is permanent.
2. **Silent upload failures**: If the initial upload fails (network timeout, auth expiry), the photo sits in IndexedDB marked as `uploaded = false` with no retry guarantee beyond the next background sync cycle.
3. **No user notification of stuck photos**: There is no persistent warning when photos have been pending upload for an extended period.

## Recovery

Unfortunately, the equipment photo **cannot be recovered** -- it was never stored on the server and has since been cleared from IndexedDB. The photo will need to be retaken.

## Preventive Fixes

### 1. Add Soft-Delete to Photo Tables (Database Migration)

Add `deleted_at` and `retention_until` columns to all three photo tables, matching the pattern used for reports. This ensures accidental deletes are recoverable for 60 days.

```sql
ALTER TABLE inspection_photos 
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN retention_until timestamptz;

ALTER TABLE training_photos 
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN retention_until timestamptz;

ALTER TABLE daily_assessment_photos 
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN retention_until timestamptz;
```

### 2. Update PhotoGallery Delete to Soft-Delete (`src/components/PhotoGallery.tsx`)

Replace the hard `DELETE` in `handleDelete` with an `UPDATE` that sets `deleted_at` and `retention_until`:

```typescript
// Before: permanent delete
.delete().eq('id', photo.id)

// After: soft delete with 60-day retention
.update({ 
  deleted_at: new Date().toISOString(),
  retention_until: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
}).eq('id', photo.id)
```

### 3. Filter Out Soft-Deleted Photos in Queries (`src/components/PhotoGallery.tsx`)

Add `.is('deleted_at', null)` to the `loadPhotos` query so soft-deleted photos are hidden from the UI but still recoverable.

### 4. Add Stale Upload Warning (`src/components/PhotoGallery.tsx`)

Show a warning badge on photos that have been pending upload for more than 10 minutes, prompting the user to check their connection.

### 5. Bump Version to v2.5.5

Update `vite.config.ts` with:
- `APP_VERSION = "2.5.5"`
- Changelog: "Photo soft-delete protection, stale upload warning"

## Files Modified

| File | Change |
|------|--------|
| Database migration | Add `deleted_at` and `retention_until` to all photo tables |
| `src/components/PhotoGallery.tsx` | Soft-delete instead of hard delete; filter deleted photos; stale upload warning |
| `vite.config.ts` | Bump to v2.5.5 |

## What Does NOT Change

- Photo capture, compression, or offline storage logic
- Background sync pipeline
- Report soft-delete system
- RLS policies (photos already protected)
- Drag-and-drop reordering

