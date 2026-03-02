

## Fix Row Ordering and Add Drag-and-Drop to Inspection Tables

### Problem
The `inspection_systems`, `inspection_ziplines`, and `inspection_equipment` tables have no `display_order` column. When data is fetched from the server, rows return in arbitrary order (typically by UUID), destroying the user's intended sequence. Drag-and-drop reordering of rows is also missing entirely.

### Solution
Two changes: (1) add a `display_order` column to persist row order, and (2) add drag-and-drop row reordering using the existing `@dnd-kit/sortable` library (already installed, already used in `PhotoGallery.tsx`).

---

### 1. Database Migration

Add `display_order` integer column to three tables:

```sql
ALTER TABLE inspection_systems ADD COLUMN display_order integer NOT NULL DEFAULT 0;
ALTER TABLE inspection_ziplines ADD COLUMN display_order integer NOT NULL DEFAULT 0;
ALTER TABLE inspection_equipment ADD COLUMN display_order integer NOT NULL DEFAULT 0;
```

No RLS changes needed -- existing policies cover all columns.

### 2. Fix Data Loading Order (`InspectionForm.tsx`)

Add `.order('display_order')` to the three Supabase queries (~lines 1025-1044):

```typescript
.from("inspection_systems").select("*").eq("inspection_id", id).order("display_order")
.from("inspection_ziplines").select("*").eq("inspection_id", id).order("display_order")
.from("inspection_equipment").select("*").eq("inspection_id", id).order("display_order")
```

### 3. Stamp `display_order` on Save (`InspectionForm.tsx`)

Before upserting, map each item's array index to `display_order`:

```typescript
// Before the upsert calls (~line 1528)
const systemsWithOrder = systems.map((s, i) => ({ ...s, display_order: i }));
const ziplinesWithOrder = ziplines.map((z, i) => ({ ...z, display_order: i }));
const equipmentWithOrder = equipment.map((e, i) => ({ ...e, display_order: i }));
```

Use these ordered arrays in both the upsert and insert operations instead of the raw arrays.

### 4. New Component: `DraggableTableRow` (`src/components/inspection/DraggableTableRow.tsx`)

A reusable wrapper using `useSortable` from `@dnd-kit/sortable`. Renders as a `<tr>` (desktop) with a `GripVertical` drag handle in the first cell. Follows the exact same pattern as the existing `DraggablePhotoItem` and `DraggableField` components.

### 5. Add DnD to `OperatingSystemsTable`

- Import `DndContext`, `SortableContext`, `arrayMove`, sensors (same as `PhotoGallery.tsx`)
- Wrap `<tbody>` content in `SortableContext` with `verticalListSortingStrategy`
- Replace `AnimatedTableRow` with `DraggableTableRow` (desktop) -- includes grip handle as first column
- Add matching grip handle to mobile card view
- Add `onDragEnd` handler that calls `arrayMove` then `onUpdate`
- Add a drag handle `<th>` to the header row

### 6. Add DnD to `ZiplinesTable`

Same pattern as OperatingSystemsTable. Wrap in DnD context, add grip handles, handle `onDragEnd`.

### 7. Add DnD to `EquipmentTable`

Same pattern, but operates on the category-filtered subset. The `onDragEnd` handler maps the reorder back to the full equipment array:
- Find the indices of `categoryEquipment` items within the full `equipment` array
- Apply `arrayMove` logic by rebuilding the full array with the category items in new order

### 8. Mobile DnD Support

For mobile card views in all three tables:
- Add a `GripVertical` drag handle at the top-left of each card (same as `DraggablePhotoItem` pattern)
- Use `TouchSensor` alongside `PointerSensor` with activation constraint (`distance: 8`) to prevent accidental drags

---

### Files Changed

| File | Action |
|------|--------|
| SQL Migration | Add `display_order` to 3 tables |
| `src/components/inspection/DraggableTableRow.tsx` | **Create** -- shared sortable table row + mobile card wrapper |
| `src/pages/InspectionForm.tsx` | **Edit** -- add `.order('display_order')` to queries; stamp `display_order` on save |
| `src/components/inspection/OperatingSystemsTable.tsx` | **Edit** -- add DnD context, sortable rows, grip handles |
| `src/components/inspection/ZiplinesTable.tsx` | **Edit** -- add DnD context, sortable rows, grip handles |
| `src/components/inspection/EquipmentTable.tsx` | **Edit** -- add DnD context, sortable rows, grip handles |

### Technical Notes

- `@dnd-kit/sortable` v10, `@dnd-kit/core` v6 are already installed
- Follows the exact DnD patterns from `PhotoGallery.tsx` and `DraggablePhotoItem.tsx`
- `PointerSensor` with `distance: 8` activation constraint prevents accidental drags during field interaction
- `display_order` defaults to 0, so existing rows load in `created_at` order until first save
- Existing `AnimatedTableRow`/`AnimatedListItem` animations are preserved alongside the drag behavior

