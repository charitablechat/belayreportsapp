

## Equipment Inventory Image Upload Feature

### Overview
Add per-item photo upload capability to Operating Systems, Ziplines, and Equipment rows in the Inspection form. Each item gets a small thumbnail showing its uploaded photo, with a lightbox modal for full-size viewing.

### Database Changes
Add a `photo_url` column to three tables via migration:

```sql
ALTER TABLE inspection_systems ADD COLUMN photo_url text;
ALTER TABLE inspection_equipment ADD COLUMN photo_url text;
ALTER TABLE inspection_ziplines ADD COLUMN photo_url text;
```

No new tables needed — the photo URL points to a file in the existing `inspection-photos` storage bucket. RLS policies already cover these tables for owners and super admins.

### New Component: `ItemPhotoUpload`
A reusable component (`src/components/inspection/ItemPhotoUpload.tsx`) that handles:

- **Upload button**: Small camera icon button; opens file picker for image capture/selection
- **Processing**: Compresses image via existing `compressImage`, uploads to `inspection-photos` bucket under `{userId}/{inspectionId}/items/{itemId}.jpg`
- **Thumbnail display**: Shows a 48x48px thumbnail of the uploaded photo using `OptimizedImage`
- **Lightbox**: Clicking the thumbnail opens a modal (`Dialog`) showing the full-resolution image with a close button and option to delete/replace
- **Offline support**: Stores photo blob in memory/state for immediate preview; actual upload happens when online (fire-and-forget pattern matching `PhotoCapture`)

### Changes to Existing Components

**1. `OperatingSystemsTable.tsx`**
- Add `ItemPhotoUpload` to each non-divider row (both desktop grid and mobile card)
- Desktop: Add a new narrow column after "Element Name" for the thumbnail
- Mobile: Add thumbnail below the element name field
- Pass `inspectionId` prop (extract from item or add as component prop)

**2. `ZiplinesTable.tsx`**
- Add `ItemPhotoUpload` to each row
- Desktop: Add column after "Line Name" for thumbnail
- Mobile: Add thumbnail below line name field
- Pass `inspectionId` prop

**3. `EquipmentTable.tsx`**
- Add `ItemPhotoUpload` to each row
- Desktop: Add column after "Type" for thumbnail
- Mobile: Add thumbnail below type field
- Pass `inspectionId` prop

**4. `InspectionForm.tsx`**
- Pass `inspectionId={id}` to the table components (already available)
- Ensure `photo_url` field is included in save/load data flows (it will be automatically since the tables use `select('*')`)

### Lightbox Component
Built into `ItemPhotoUpload` using the existing `Dialog` component:
- Full-screen overlay with the image displayed at native aspect ratio
- Close button (X) in corner
- "Replace" button to upload a new photo
- "Remove" button to clear the photo_url

### Data Flow
```text
User taps camera icon → File picker → compressImage() → 
Upload to inspection-photos bucket → Update item.photo_url → 
Trigger onImmediateSave → Thumbnail appears in row
```

### Files to Create
| File | Purpose |
|------|---------|
| `src/components/inspection/ItemPhotoUpload.tsx` | Reusable per-item photo upload + thumbnail + lightbox |

### Files to Modify
| File | Change |
|------|--------|
| `src/components/inspection/OperatingSystemsTable.tsx` | Add photo column + `ItemPhotoUpload` per row |
| `src/components/inspection/ZiplinesTable.tsx` | Add photo column + `ItemPhotoUpload` per row |
| `src/components/inspection/EquipmentTable.tsx` | Add photo column + `ItemPhotoUpload` per row |
| `src/pages/InspectionForm.tsx` | Pass `inspectionId` to table components if not already available |
| Database migration | Add `photo_url text` column to 3 tables |

