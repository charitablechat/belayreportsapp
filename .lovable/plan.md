

## Fix: Place Cursor at End of Text on Focus (Not Select All)

### Problem
When an autocomplete input in the inspection tables receives focus (either by clicking or via auto-focus on new row), the browser selects all text. This makes it easy to accidentally overwrite existing content.

### Changes

**1. `src/components/GlobalAutocomplete.tsx` — `handleTriggerFocus` (~line 292)**
After setting `inputValue`, use `requestAnimationFrame` + `setSelectionRange` to move the cursor to the end of the text:

```typescript
const handleTriggerFocus = () => {
  setIsEditing(true);
  setInputValue(value);
  // Place cursor at end of text, not select-all
  requestAnimationFrame(() => {
    const input = triggerInputRef.current;
    if (input) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });
  if (!open) setOpen(true);
  if (!hasFetchedFromDb.current) fetchGlobalHistory();
};
```

**2. `src/components/OrganizationAutocomplete.tsx` — `handleTriggerFocus` (~line 207)**
Same pattern — after setting `search` to `value`, move cursor to end:

```typescript
const handleTriggerFocus = () => {
  setIsEditing(true);
  setSearch(value);
  requestAnimationFrame(() => {
    const input = triggerInputRef.current;
    if (input) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });
  if (!open) setOpen(true);
};
```

**3. Auto-focus in table `useEffect` (all 3 tables)**
Remove the `input?.click()` call (line 51 in each table). The `.focus()` is sufficient to activate the field; `.click()` triggers select-all behavior and is unnecessary now.

| File | Change |
|------|--------|
| `src/components/GlobalAutocomplete.tsx` | Add `setSelectionRange` in `handleTriggerFocus` |
| `src/components/OrganizationAutocomplete.tsx` | Same |
| `src/components/inspection/ZiplinesTable.tsx` | Remove `input?.click()` on line 51 |
| `src/components/inspection/EquipmentTable.tsx` | Remove `input?.click()` on line 60 |
| `src/components/inspection/OperatingSystemsTable.tsx` | Remove `input?.click()` on line 51 |

