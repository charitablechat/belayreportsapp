
# Plan: Add Delete Functionality with Confirmation to Inspection Report Sections

## Overview
Add delete buttons with confirmation dialogs to **Equipment** and **Ziplines** tables in the Inspection Report. The **Operating Systems** table already has this functionality implemented (without confirmation), which needs to be enhanced with a confirmation dialog.

## Current State Analysis

| Component | Has Delete Button | Has Confirmation Dialog |
|-----------|------------------|------------------------|
| `OperatingSystemsTable.tsx` | ✅ Yes (red Trash2 icon) | ❌ No |
| `EquipmentTable.tsx` | ❌ No | ❌ No |
| `ZiplinesTable.tsx` | ❌ No | ❌ No |
| `StandardsTable.tsx` | N/A (fixed list of checkboxes) | N/A |

## Visual Specification (from reference image)
- **Icon**: `Trash2` from lucide-react
- **Color**: Red/destructive (`text-destructive`)
- **Position**: Far right of each row in a dedicated column
- **Size**: Small button (`h-8 w-8 p-0`)
- **Hover State**: Light red background (`hover:bg-destructive/10`)

## Implementation Steps

### Step 1: Update OperatingSystemsTable.tsx
Add confirmation dialog before deletion (currently deletes immediately):
- Add state for tracking pending deletion: `const [itemToDelete, setItemToDelete] = useState<{index: number, name: string} | null>(null)`
- Wrap delete action in confirmation dialog
- Update delete button to open dialog instead of immediate delete

### Step 2: Update EquipmentTable.tsx
Add delete column and confirmation dialog:
- Import `Trash2` from lucide-react
- Import AlertDialog components
- Add state for pending deletion
- Add delete column header and button to desktop table view
- Add delete button to mobile card view (positioned top-right like Operating Systems)
- Add confirmation dialog at component level
- Create `deleteEquipment` function to handle removal

### Step 3: Update ZiplinesTable.tsx
Add delete column and confirmation dialog:
- Same pattern as EquipmentTable
- Add narrower delete column (table already has many columns)
- Position delete button appropriately for mobile view

---

## Technical Details

### Delete Confirmation Dialog Pattern (consistent across all tables)

```typescript
// State
const [itemToDelete, setItemToDelete] = useState<{index: number, name: string} | null>(null);

// Delete handler
const handleDeleteConfirm = () => {
  if (itemToDelete) {
    const updated = items.filter((_, i) => i !== itemToDelete.index);
    onUpdate(updated);
    onImmediateSave?.();
    setItemToDelete(null);
  }
};

// Dialog JSX
<AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete [Item Type]</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete <strong>{itemToDelete?.name || "this item"}</strong>?
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction 
        onClick={handleDeleteConfirm}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### Delete Button Pattern

```typescript
// Desktop table cell
<td className="border p-2 text-center">
  <Button
    variant="ghost"
    size="sm"
    onClick={() => setItemToDelete({ index, name: item.name || "this item" })}
    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
  >
    <Trash2 className="h-4 w-4" />
  </Button>
</td>

// Mobile card (absolute positioned)
<Button
  variant="ghost"
  size="sm"
  onClick={() => setItemToDelete({ index, name: item.name || "this item" })}
  className="absolute top-2 right-2 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
>
  <Trash2 className="h-4 w-4" />
</Button>
```

---

## Files to Modify

| File | Action | Changes |
|------|--------|---------|
| `src/components/inspection/OperatingSystemsTable.tsx` | Modify | Add AlertDialog confirmation before delete |
| `src/components/inspection/EquipmentTable.tsx` | Modify | Add delete column, button, and confirmation dialog |
| `src/components/inspection/ZiplinesTable.tsx` | Modify | Add delete column, button, and confirmation dialog |

---

## Detailed Changes per File

### OperatingSystemsTable.tsx Changes
1. Import AlertDialog components
2. Add `itemToDelete` state
3. Change `deleteSystem(index)` to `setItemToDelete({index, name: system.name})`
4. Add `handleDeleteConfirm` function
5. Add AlertDialog JSX before closing `</Card>` tag

### EquipmentTable.tsx Changes
1. Import: `Trash2` from lucide-react
2. Import: AlertDialog components from `@/components/ui/alert-dialog`
3. Add state: `const [itemToDelete, setItemToDelete] = useState<{item: any, name: string} | null>(null)`
4. Add function: `deleteEquipment(item)` - filters by item reference
5. Desktop table: Add empty header column (`<th className="border p-3 text-center font-semibold text-sm w-16"></th>`)
6. Desktop table: Add delete cell at end of each row
7. Mobile card: Add relative positioning and delete button
8. Add AlertDialog at end of component

### ZiplinesTable.tsx Changes
1. Same imports as EquipmentTable
2. Same state pattern
3. Add delete function: `deleteZipline(index)`
4. Desktop table: Add delete column header
5. Desktop table: Add delete cell
6. Mobile card: Add delete button (positioned top-right)
7. Add AlertDialog

---

## Safety & Atomicity

- **Non-destructive until confirmed**: Delete button opens dialog, no data is modified
- **Atomic update**: Full array is replaced in single `onUpdate()` call
- **Immediate persistence**: `onImmediateSave?.()` called after confirmed deletion
- **Consistent with existing patterns**: Uses same AlertDialog pattern as Dashboard deletion

---

## Testing Checklist
- [ ] Verify delete icon appears on all Equipment rows (desktop + mobile)
- [ ] Verify delete icon appears on all Ziplines rows (desktop + mobile)
- [ ] Verify Operating Systems now shows confirmation dialog
- [ ] Test canceling deletion - data should remain unchanged
- [ ] Test confirming deletion - item should be removed
- [ ] Verify deleted data is persisted (reload page)
- [ ] Test on mobile devices for proper button positioning
- [ ] Verify existing functionality (add, edit) still works
