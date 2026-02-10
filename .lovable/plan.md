

# Fix Production Year Input Blocking

## Root Cause

The `onChange` handler validates the **full range (1900-2100) on every keystroke**. When a user types "1998" character by character:

- Types "1" --> `parseInt("1")` = 1 --> `1 >= 1900` is FALSE --> **input rejected, nothing appears**
- The user can never reach a valid 4-digit year because partial input is always blocked

This same bug exists in both the desktop (line 183) and mobile (line 316) views.

## Fix

Allow any partial numeric input during typing, and only enforce the 1900-2100 range on blur (when the user finishes typing). This matches standard year-input UX.

### `src/components/inspection/EquipmentTable.tsx` (2 locations)

**Desktop input (~line 179-185) and Mobile input (~line 312-318):**

Replace the onChange logic:

```js
// BEFORE (blocks partial input):
onChange={(e) => {
  const raw = e.target.value;
  if (raw === "") { updateEquipment(item, "production_year", null); return; }
  const val = parseInt(raw, 10);
  if (!isNaN(val) && val >= 1900 && val <= 2100) {
    updateEquipment(item, "production_year", val);
  }
}}

// AFTER (allows typing, validates on blur):
onChange={(e) => {
  const raw = e.target.value;
  if (raw === "") { updateEquipment(item, "production_year", null); return; }
  // Allow any digits up to 4 characters while typing
  if (/^\d{0,4}$/.test(raw)) {
    updateEquipment(item, "production_year", parseInt(raw, 10));
  }
}}
```

Also update `onBlur` to clamp or clear out-of-range values:

```js
// BEFORE:
onBlur={onImmediateSave}

// AFTER:
onBlur={() => {
  // Clamp to valid range on blur
  if (item.production_year && (item.production_year < 1900 || item.production_year > 2100)) {
    updateEquipment(item, "production_year", null);
  }
  onImmediateSave?.();
}}
```

## Files Changed

| File | What |
|------|------|
| `src/components/inspection/EquipmentTable.tsx` | Fix onChange to allow partial year input; add onBlur range validation (desktop + mobile, 2 locations each) |

