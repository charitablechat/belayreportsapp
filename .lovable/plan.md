

## Auto-Populate Item Photos to Photo Gallery Sections

### What Changes

When a user adds a photo to a specific system, zipline, or equipment item, that photo will automatically also appear in the corresponding photo gallery section at the bottom of the tab — labeled with the item name.

### How It Works

1. **Add new props to `ItemPhotoUpload`**: `itemName` (string) and `photoSection` (string, e.g. "systems" or "equipment") so the component knows what label and section to use.

2. **On successful upload in `ItemPhotoUpload`**: After uploading the photo to storage, also insert a row into the `inspection_photos` table with:
   - `inspection_id`: the current inspection
   - `photo_url`: the same storage path
   - `photo_section`: mapped section ("systems" for operating systems and ziplines, "equipment" for equipment items)
   - `caption`: the item name (e.g. "Harness - Item #3" or the actual element name)

3. **On photo removal in `ItemPhotoUpload`**: Also delete the corresponding `inspection_photos` row (matched by `photo_url`).

4. **Update callers** to pass the new props:
   - `OperatingSystemsTable`: pass `itemName={system.name || system.system_name}` and `photoSection="systems"`
   - `ZiplinesTable`: pass `itemName={zipline.zipline_name}` and `photoSection="systems"`
   - `EquipmentTable`: pass `itemName={item.name || item.equipment_type}` and `photoSection="equipment"`

5. **Refresh the photo gallery** after item photo changes by triggering the existing `photoRefreshKey` mechanism. Add an `onGalleryRefresh` callback prop to `ItemPhotoUpload`, threaded down from `InspectionForm`.

### Files Modified

| File | Change |
|------|--------|
| `src/components/inspection/ItemPhotoUpload.tsx` | Add `itemName`, `photoSection`, `onGalleryRefresh` props; insert/delete `inspection_photos` row on upload/remove |
| `src/components/inspection/OperatingSystemsTable.tsx` | Pass new props + thread `onGalleryRefresh` |
| `src/components/inspection/ZiplinesTable.tsx` | Pass new props + thread `onGalleryRefresh` |
| `src/components/inspection/EquipmentTable.tsx` | Pass new props + thread `onGalleryRefresh` |
| `src/pages/InspectionForm.tsx` | Pass `onGalleryRefresh` callback to the three table components |

### Technical Detail

**ItemPhotoUpload — after successful upload:**
```typescript
// Insert into inspection_photos for gallery display
await supabase.from('inspection_photos').insert({
  inspection_id: inspectionId,
  photo_url: filePath,
  photo_section: photoSection,
  caption: itemName || 'Item photo',
});
onGalleryRefresh?.();
```

**ItemPhotoUpload — on remove:**
```typescript
// Also remove from gallery
await supabase.from('inspection_photos')
  .delete()
  .eq('photo_url', photoUrl)
  .eq('inspection_id', inspectionId);
onGalleryRefresh?.();
```

The photo gallery already displays captions, so item photos will automatically show with their label.

