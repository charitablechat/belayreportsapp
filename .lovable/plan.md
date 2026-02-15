
# Allow Tab Switching on Locked Completed Reports

## Problem

The four category tabs (Systems - Ziplines, Equipment, Operations Criteria, Summary) are rendered as `<button>` elements by Radix `TabsTrigger`. The click interceptor for locked reports matches `button:not([data-nav])`, which catches tab clicks and shows the "REPORT LOCKED" warning instead of letting the user switch tabs.

## Solution

A one-line change in `src/pages/InspectionForm.tsx`: exclude `[role="tab"]` from the editable-field selector in `handleLockedFieldClick`. Radix TabsTrigger always renders with `role="tab"`, so this cleanly distinguishes navigation buttons from data-editing buttons.

### Change

**File: `src/pages/InspectionForm.tsx` (~line 138)**

Update the selector from:
```
'input, textarea, select, [role="checkbox"], [role="combobox"], [contenteditable], .tiptap, button:not([data-nav])'
```
to:
```
'input, textarea, select, [role="checkbox"], [role="combobox"], [contenteditable], .tiptap, button:not([data-nav]):not([role="tab"])'
```

This adds `:not([role="tab"])` to the button match, allowing all Radix tab triggers to pass through the interceptor untouched while still blocking clicks on other buttons (dropdowns, toggles, etc.).

## Why This Works

- Radix `TabsTrigger` always renders `role="tab"` on its underlying button element
- No other editable/data-modifying button in the form uses `role="tab"`
- The `onValueChange` handler on `<Tabs>` will fire normally, switching the visible content
- All actual data fields (inputs, selects, checkboxes) remain intercepted

## Files Changed

1. **`src/pages/InspectionForm.tsx`** -- Update selector string in `handleLockedFieldClick` (1 line)
