

## Fix: Cursor-at-End on Focus for All Autocomplete Components

### Status
`GlobalAutocomplete.tsx` and `OrganizationAutocomplete.tsx` already have the `setSelectionRange` fix. Two other autocomplete components are missing it:

### Changes

**1. `src/components/DatabaseAutocomplete.tsx` — `handleTriggerFocus` (line 255-259)**
Add `requestAnimationFrame` + `setSelectionRange` after `setSearchValue(value)`:
```typescript
const handleTriggerFocus = () => {
  setIsEditing(true);
  setSearchValue(value);
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

**2. `src/components/HistoryAutocomplete.tsx` — `handleTriggerFocus` (line 268-274)**
Same pattern:
```typescript
const handleTriggerFocus = () => {
  setIsEditing(true);
  setInputValue(value);
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

### Files
| File | Change |
|------|--------|
| `DatabaseAutocomplete.tsx` | Add `setSelectionRange` in `handleTriggerFocus` |
| `HistoryAutocomplete.tsx` | Add `setSelectionRange` in `handleTriggerFocus` |

