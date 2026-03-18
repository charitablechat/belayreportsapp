

## Add Batch Photo Deletion to PhotoGallery

The `PhotoGallery` component already supports single photo deletion (soft-delete with 60-day retention). It's a shared component used by inspections, trainings, and daily assessments via the `tableName` prop. The changes below add batch selection and deletion to this shared component, benefiting all report types.

### Changes to `src/components/PhotoGallery.tsx`

**1. Add selection state and batch mode toggle**
- New state: `selectedIds: Set<string>`, `batchMode: boolean`
- A "Select" / "Cancel" toggle button above the photo grid (hidden when `readOnly`)
- A "Select All" / "Deselect All" button when in batch mode
- A floating "Delete (N)" button when photos are selected

**2. Add selection UI to each photo card**
- When `batchMode` is true, show a `Checkbox` overlay (top-left, replacing the drag handle) on each photo card
- Tapping a photo in batch mode toggles selection instead of dragging
- Selected photos get a visible ring/border highlight (e.g., `ring-2 ring-destructive`)

**3. Batch delete handler**
- `handleBatchDelete` processes all selected photos using the same soft-delete logic as `handleDelete`
- For uploaded+online photos: single batch update query (`supabase.from(tableName).update({deleted_at, retention_until}).in('id', ids)`) instead of N individual calls
- For uploaded+offline photos: queue each as an offline operation
- For local-only photos: delete each from IndexedDB
- Refresh gallery after completion

**4. Confirmation dialog**
- Use existing `AlertDialog` component before executing batch delete
- Shows count of photos to be deleted: "Delete N photos? This action can be recovered within 60 days."

**5. Single delete confirmation**
- Wrap existing single-photo delete in the same `AlertDialog` pattern for consistency

### Technical Notes
- Batch mode disables drag-and-drop (pass `disabled={true}` to `DraggablePhotoItem` when `batchMode` is active)
- The Lovable preview guard (`isLovablePreview()`) applies to batch delete as well
- No database migrations needed; uses existing soft-delete columns (`deleted_at`, `retention_until`)

