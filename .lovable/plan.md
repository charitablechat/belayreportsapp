

# Photo Gallery Drag-and-Drop Reordering Implementation

## Overview

This plan implements a touch-first drag-and-drop feature for reorganizing photos within the PhotoGallery component. The implementation leverages the existing `@dnd-kit` library (already installed and used in the admin CMS) to provide a polished, accessible, and mobile-optimized experience.

---

## Current State Analysis

### Existing Infrastructure
- **@dnd-kit/core**, **@dnd-kit/sortable**, and **@dnd-kit/utilities** are already installed
- Existing drag patterns in `DraggableField.tsx`, `DraggableSection.tsx`, and `FormCMSManager.tsx` provide proven patterns
- Haptic feedback utilities exist in `src/lib/haptics.ts`
- PhotoGallery currently displays photos in a CSS grid without ordering capability

### Database Gap
The `inspection_photos` table currently lacks a `display_order` column to persist the order of photos. A migration is required.

---

## Implementation Strategy

### Phase 1: Database Schema Update

Add `display_order` column to `inspection_photos` table:

```sql
ALTER TABLE public.inspection_photos
ADD COLUMN display_order integer DEFAULT 0;

-- Add index for efficient ordering queries
CREATE INDEX idx_inspection_photos_order 
ON public.inspection_photos(inspection_id, photo_section, display_order);
```

### Phase 2: Create DraggablePhotoItem Component

A new component wrapping individual photo cards with sortable functionality:

```text
src/components/DraggablePhotoItem.tsx
```

**Key Features:**
- Uses `useSortable` hook from @dnd-kit/sortable
- Visual feedback during drag (opacity, shadow, scale)
- Touch-optimized drag handle
- Smooth CSS transitions using `CSS.Transform.toString(transform)`

### Phase 3: Update PhotoGallery Component

Transform the gallery to support sortable photo ordering:

**New Imports:**
```typescript
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
```

**Sensor Configuration:**
```typescript
// Touch-first sensor setup for mobile
const sensors = useSensors(
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 200,        // Prevent accidental drags
      tolerance: 5,       // Minimum movement before drag starts
    },
  }),
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,        // Mouse drag threshold
    },
  }),
  useSensor(KeyboardSensor)
);
```

---

## Visual Feedback Requirements

### 1. Dynamic Shifting (Requirement: Surrounding items shift dynamically)

**Implementation:**
- Use `rectSortingStrategy` from @dnd-kit for grid layouts
- CSS transitions applied via `CSS.Transform.toString(transform)` + `transition` property
- Items smoothly animate to new positions as dragged item moves

```typescript
const style = {
  transform: CSS.Transform.toString(transform),
  transition: transition || 'transform 200ms ease',
};
```

### 2. Visual Distinction (Requirement: Dragged item is visually distinct)

**Implementation:**
- **Opacity reduction**: Dragged item becomes semi-transparent (0.5)
- **Elevation**: Box shadow added via `DragOverlay`
- **Scale**: Slight enlargement (1.05x) on the overlay

```typescript
// Dragged item in original position
const style = {
  opacity: isDragging ? 0.4 : 1,
  transform: CSS.Transform.toString(transform),
  transition,
};

// DragOverlay for the "floating" copy
<DragOverlay>
  {activePhoto && (
    <div className="shadow-2xl scale-105 rotate-2 rounded-lg overflow-hidden">
      <img src={activePhoto.photoUrl} className="w-full h-48 object-cover" />
    </div>
  )}
</DragOverlay>
```

### 3. Placeholder Indication (Requirement: Clear drop target indication)

**Implementation:**
- Gap opens between items showing where photo will land
- Border highlight on adjacent items during hover
- Optional dotted placeholder box

```css
/* When an item would be inserted, adjacent items show visual gap */
.sortable-item-over {
  border: 2px dashed hsl(var(--primary));
  opacity: 0.8;
}
```

---

## Haptic Feedback Integration

Leveraging existing `triggerHaptic()` function:

| Event | Haptic Type | Description |
|-------|-------------|-------------|
| Drag Start | `'selection'` | Light tap when photo picked up |
| Drag Over | `'light'` | Subtle feedback when crossing boundaries |
| Drop Complete | `'success'` | Confirmation pattern on successful reorder |
| Drop Cancel | `'error'` | Error pattern if reorder fails |

---

## Files to Create/Modify

### New File: `src/components/DraggablePhotoItem.tsx`

```text
Purpose: Sortable wrapper for individual photo cards
Dependencies: @dnd-kit/sortable, existing Card component

Structure:
- useSortable hook integration
- Touch-optimized drag handle (GripVertical icon)
- Visual state styling (isDragging, isOver)
- Delegated children rendering
```

### Modified File: `src/components/PhotoGallery.tsx`

| Change | Description |
|--------|-------------|
| Add imports | DndContext, SortableContext, sensors, arrayMove |
| Add state | `activeId` for tracking currently dragged photo |
| Wrap grid | SortableContext with `rectSortingStrategy` |
| Replace Card | DraggablePhotoItem wrapper |
| Add handlers | `handleDragStart`, `handleDragEnd`, `handleDragCancel` |
| Add DragOverlay | Floating preview of dragged photo |
| Add persist function | `updatePhotoOrder()` to save to database |

### Modified File: `src/lib/offline-storage.ts`

Add support for photo ordering in IndexedDB:

```typescript
export async function updatePhotoOrder(
  inspectionId: string, 
  photoIds: string[]
): Promise<void> {
  // Update display_order for each photo in IndexedDB
}
```

---

## Drag-and-Drop Flow Diagram

```text
+------------------+     +-------------------+     +------------------+
|   User touches   | --> |  TouchSensor      | --> |  DndContext      |
|   photo card     |     |  activates after  |     |  onDragStart     |
|                  |     |  200ms delay      |     |                  |
+------------------+     +-------------------+     +------------------+
                                                           |
                                                           v
+------------------+     +-------------------+     +------------------+
|  DragOverlay     | <-- |  Active photo     | <-- |  triggerHaptic   |
|  shows floating  |     |  becomes ghost    |     |  ('selection')   |
|  preview         |     |  (opacity: 0.4)   |     |                  |
+------------------+     +-------------------+     +------------------+
                                                           |
                                                           v
+------------------+     +-------------------+     +------------------+
|  Other photos    | <-- |  rectSorting      | <-- |  User drags      |
|  shift smoothly  |     |  Strategy         |     |  photo around    |
|  to show gap     |     |  animates items   |     |                  |
+------------------+     +-------------------+     +------------------+
                                                           |
                                                           v
+------------------+     +-------------------+     +------------------+
|  arrayMove       | --> |  Update local     | --> |  Persist to DB   |
|  reorders array  |     |  photos state     |     |  (if online) or  |
|                  |     |                   |     |  IndexedDB       |
+------------------+     +-------------------+     +------------------+
```

---

## Accessibility Considerations

| Feature | Implementation |
|---------|----------------|
| Keyboard navigation | KeyboardSensor with arrow key support |
| Screen reader | Announcements via `announcements` prop on DndContext |
| Focus management | Auto-focus drag handle after drop |
| ARIA labels | `aria-grabbed`, `aria-dropeffect` on items |

---

## Offline Support

The implementation must work seamlessly offline:

1. **Local State**: Reordering updates local `photos` state immediately
2. **IndexedDB**: Order persisted to IndexedDB photo records
3. **Background Sync**: When online, sync display_order to database
4. **Conflict Resolution**: Last-write-wins for order conflicts

---

## Summary

| Component | Action |
|-----------|--------|
| Database | Add `display_order` column to `inspection_photos` |
| DraggablePhotoItem.tsx | **Create** - Sortable photo card wrapper |
| PhotoGallery.tsx | **Modify** - Add DndContext + SortableContext |
| offline-storage.ts | **Modify** - Add photo order sync support |
| Haptics | **Utilize** - Existing functions for touch feedback |

**Total Estimated Changes:**
- 1 database migration
- 1 new component file (~80 lines)
- 2 modified files (~100 lines changes each)

