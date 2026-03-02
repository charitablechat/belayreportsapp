

## Replace @dnd-kit with Native HTML5 Drag-and-Drop

### Approach

Completely remove all `@dnd-kit` usage from the table row components and replace with native HTML5 drag events (`draggable`, `onDragStart`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop`, `onDragEnd`). The browser handles the ghost image natively with no offset issues. A blue insertion line is rendered based on cursor position relative to each row's midpoint.

### File 1: `DraggableTableRow.tsx` -- Full Rewrite

Remove all `@dnd-kit` imports. The components become simple wrappers that accept native drag event handlers from the parent.

```typescript
// New props -- no library, just native event forwarding
interface DraggableTableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
  gridCols: string;
  isDragging?: boolean;
  dropIndicator?: 'above' | 'below' | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}
```

- Row container: `draggable={true}`, wires all native drag events
- Grip handle: `cursor-grab` / `cursor-grabbing` via CSS
- `isDragging`: parent sets this when the row's id matches the dragged id (opacity 0.4)
- `dropIndicator`: parent passes `'above'` or `'below'` -- renders a 3px blue line as `border-top` or `border-bottom`
- Same pattern for `DraggableMobileCard`

### Files 2-4: Table Components (OperatingSystems, Ziplines, Equipment)

**Remove all @dnd-kit imports**: `DndContext`, `DragOverlay`, `SortableContext`, `PointerSensor`, `TouchSensor`, `closestCenter`, `useSensor`, `useSensors`, `arrayMove`, `verticalListSortingStrategy`.

**Add state:**
```typescript
const draggedIdRef = useRef<string | null>(null);
const [draggingId, setDraggingId] = useState<string | null>(null);
const [dragOverId, setDragOverId] = useState<string | null>(null);
const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);
```

**Handlers:**
- `handleDragStart(e, id)`: Store id in ref and state, set `e.dataTransfer.effectAllowed = 'move'`
- `handleDragOver(e, id)`: `e.preventDefault()`, calculate midpoint via `getBoundingClientRect()`, set `dragOverId` and `dropPosition`
- `handleDragLeave()`: Clear `dragOverId` and `dropPosition`
- `handleDrop(e, id)`: Reorder array -- remove dragged item, insert before or after target based on `dropPosition`. Clear all state.
- `handleDragEnd()`: Clear all state (fires even if drop is cancelled)

**Reorder logic** (replaces `arrayMove`):
```typescript
const items = [...currentItems];
const dragIdx = items.findIndex(i => i.id === draggedIdRef.current);
const [draggedItem] = items.splice(dragIdx, 1);
const targetIdx = items.findIndex(i => i.id === targetId);
const insertIdx = dropPosition === 'below' ? targetIdx + 1 : targetIdx;
items.splice(insertIdx, 0, draggedItem);
```

For `EquipmentTable`, the same category-aware reorder logic is preserved -- filter by category, reorder within category, then reconstruct the full array.

**Remove `DragOverlay`**: No ghost element needed -- the browser provides the native drag image automatically.

**Remove `SortableContext` wrapper**: Rows are just mapped directly.

### Changes Summary

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Remove all `@dnd-kit` imports. Accept native drag event handlers + `isDragging` + `dropIndicator` as props. Use `draggable={true}` with native HTML5 events. Render blue 3px insertion line based on `dropIndicator` prop. |
| `OperatingSystemsTable.tsx` | Remove all `@dnd-kit` imports. Add native drag state (`draggedIdRef`, `draggingId`, `dragOverId`, `dropPosition`). Implement `handleDragStart/Over/Leave/Drop/End`. Remove `DndContext`, `SortableContext`, `DragOverlay`. Pass native handlers to each row. |
| `ZiplinesTable.tsx` | Same pattern as OperatingSystems. |
| `EquipmentTable.tsx` | Same pattern, with category-aware reorder logic preserved. |

### Why This Fixes Everything

1. **Ghost offset**: The browser renders the native drag image at the cursor position automatically. No custom overlay, no scroll offset calculations, no portal needed.
2. **Drop indicator**: Calculated from `e.clientY` vs row midpoint on every `dragOver` event. Renders as a visible 3px blue border on the correct side of the target row.
3. **No library bugs**: Zero dependency on `@dnd-kit` transform/transition/collision detection systems that were causing persistent issues in scrollable containers.

