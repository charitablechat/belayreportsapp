

## Fix: "Add System/Zipline/Equipment" Button Opens Photo Picker

### Root Cause
The auto-focus `useEffect` that runs when a new row is added uses this selector:
```
input:not([disabled]), [contenteditable="true"], [tabindex="0"]
```
The `<input type="file">` inside `ItemPhotoUpload` is the **first** `input` in each row's DOM (photo column comes before name column). The `.focus()` + `.click()` on line 50-51 triggers the file picker instead of focusing the name field.

### Fix
Add `:not([type="file"])` to the selector in all 3 files so file inputs are skipped:

| File | Line | Change |
|------|------|--------|
| `OperatingSystemsTable.tsx` | 48 | `'input:not([disabled]):not([type="file"]), ...'` |
| `ZiplinesTable.tsx` | 48 | Same |
| `EquipmentTable.tsx` | 57 | Same |

One-word addition per file. The "Add System" button will correctly create a new row and focus the name input field.

