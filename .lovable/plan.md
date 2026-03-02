

## Fix: Collision Detection Returns Self (The Actual Bug)

### What the Session Replay Proves

The DragOverlay IS tracking the cursor correctly -- transforms like `translate3d(148px, 265px, 0px)` show smooth cursor following. The problem is that every drop resolves to the SAME item being dropped on itself:

```
Draggable item (ID: 0f05da52-...) dropped over droppable area (ID: 0f05da52-...)
```

The `onDragEnd` handler has `if (active.id === over.id) return` -- so it correctly ignores this and nothing happens. The drag "works" mechanically but never detects a different row as the target.

### Why closestCenter Fails Here

`closestCenter` compares the pointer position to the CENTER of every droppable rect, including the active (dragged) item itself. Since we disabled transforms (rows stay in place), the dragged row's rect remains at its original DOM position. The pointer starts near that row's grip handle, which is close to its center. For tall rows (100px+), you'd need to drag past the center of the NEXT row before it "wins" -- and by then the pointer may still be closer to the original row's center.

This is why the photo gallery works: small, uniform items mean `closestCenter` quickly finds a neighbor.

### The Fix: Three Changes

#### 1. Custom collision detection that EXCLUDES the active item

Create a simple wrapper around `closestCenter` that filters out the active draggable before running collision detection. This ensures the dragged row can never be its own drop target.

```text
function closestCenterExcludeActive({ active, ...args }) {
  // Filter out the active item from droppable containers
  const filtered = args.droppableContainers.filter(c => c.id !== active.id);
  return closestCenter({ active, ...args, droppableContainers: filtered });
}
```

This goes directly in each table component (3-4 lines each), no new files needed.

#### 2. Add onDragOver handler for real-time drop target tracking

Track `overId` state via `onDragOver` to render a visible insertion line between rows. The `isOver` from `useSortable` may not fire reliably when transforms are disabled, so we track it at the DndContext level.

```text
const [overId, setOverId] = useState<string | null>(null);

<DndContext onDragOver={(e) => setOverId(e.over?.id as string | null)} ...>
```

Pass `overId` to `DraggableTableRow` as a prop to render the insertion indicator.

#### 3. Add insertion line indicator to DraggableTableRow

Add a `isDropTarget` prop to `DraggableTableRow` and `DraggableMobileCard`. When true, render a prominent 3px blue line at the top of the row:

```text
// Before the grid content
{isDropTarget && (
  <div className="absolute top-0 left-0 right-0 h-[3px] bg-primary rounded-full 
    -translate-y-1/2 z-10 shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
)}
```

This gives unambiguous visual feedback showing exactly where the item will be inserted.

### Files Changed

| File | Change |
|------|--------|
| `DraggableTableRow.tsx` | Add `isDropTarget` prop to both components; render insertion line indicator; keep transform: undefined |
| `OperatingSystemsTable.tsx` | Add custom collision function excluding active item; add `overId` state via `onDragOver`; pass `isDropTarget` to rows |
| `ZiplinesTable.tsx` | Same changes as OperatingSystems |
| `EquipmentTable.tsx` | Same changes as OperatingSystems |

### Data Safety

Zero risk. Only collision detection filtering and visual indicator changes. `onDragEnd`, `onUpdate`, `arrayMove` logic is completely untouched.

### Why This Will Actually Work

1. Excluding the active item from collision detection is a well-known dnd-kit pattern for overlay-based DnD
2. `closestCenter` will now correctly identify the nearest NON-active row
3. The insertion line gives clear visual feedback independent of any transform/isOver mechanism
4. The DragOverlay already tracks the cursor perfectly (confirmed by session replay)

