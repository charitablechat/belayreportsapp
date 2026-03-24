

## Auto-Focus New Row's First Input on Add

### Summary

When "Add System", "Add Zipline", or "Add Equipment" is clicked, automatically focus the first input field in the newly created row so the user can start typing immediately.

### Approach

Use a `useEffect` + ref pattern: each table tracks a `newItemId` state. When an item is added, store its ID. After React re-renders with the new row, find the row by `data-row-id` attribute and focus its first focusable input.

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/OperatingSystemsTable.tsx` | Track `newItemId` state; set it in `addSystem`; add `useEffect` to focus first input in the new row via `[data-row-id="${newItemId}"]`; add `data-row-id` to each row |
| `src/components/inspection/ZiplinesTable.tsx` | Same pattern for `addZipline` |
| `src/components/inspection/EquipmentTable.tsx` | Same pattern for `addEquipment` |

### Technical Detail

Each table gets:

```typescript
const [newItemId, setNewItemId] = useState<string | null>(null);

// In addSystem/addZipline/addEquipment:
const id = `temp-${crypto.randomUUID()}`;
setNewItemId(id);
onUpdate(prev => [{ id, ...fields }, ...prev]);

// After render, focus the first input in that row:
useEffect(() => {
  if (!newItemId) return;
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-row-id="${newItemId}"]`);
    if (row) {
      const input = row.querySelector<HTMLElement>(
        'input:not([disabled]), [contenteditable="true"], [tabindex="0"]'
      );
      input?.focus();
      input?.click(); // activates LazyRichTextEditor placeholders
    }
    setNewItemId(null);
  });
}, [newItemId]);
```

Each `DraggableTableRow` / `DraggableMobileCard` already receives the item `id` — we just need to add `data-row-id={id}` to the rendered wrapper so we can query it.

