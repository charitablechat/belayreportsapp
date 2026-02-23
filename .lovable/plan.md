

## Fix: Locked Report Dialog Not Triggering for All Editable Actions

### Issue Summary

The completion lock on finished reports is not blocking all edit actions. Users can add new rows, delete existing rows, and click action buttons on locked reports without ever seeing the "REPORT LOCKED" dialog.

### Root Cause

The lock interception relies on a CSS selector in `handleLockedFieldClick` that only matches specific form elements:

```
input, textarea, select, [contenteditable="true"],
[role="combobox"], [role="listbox"], [role="switch"],
[role="checkbox"], [role="radio"], [role="slider"],
button[data-editable], .tiptap, .ProseMirror
```

Regular buttons (like "Add System", "Add Zipline", "Delete" trash icons, etc.) do NOT match `button[data-editable]` because they lack the `data-editable` attribute. These buttons execute their `onClick` handlers normally, bypassing the lock entirely.

Additionally, the table/section child components (`OperatingSystemsTable`, `ZiplinesTable`, `EquipmentTable`, `StandardsTable`, `SummarySection`) do not receive a `readOnly` prop, so they always render as fully editable.

### Fix Approach

Expand the `handleLockedFieldClick` selector to also intercept clicks on ANY `button` element within the locked container, not just `button[data-editable]`. This is the simplest, most comprehensive fix that closes all gaps without needing to modify every child component.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Change `button[data-editable]` to `button` in the `handleLockedFieldClick` selector |
| `src/pages/TrainingForm.tsx` | Same change |
| `src/pages/DailyAssessmentForm.tsx` | Same change |

### Technical Detail

In each form's `handleLockedFieldClick` callback, the selector changes from:

```typescript
const isEditable = target.closest(
  'input, textarea, select, [contenteditable="true"], ' +
  '[role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], ' +
  'button[data-editable], .tiptap, .ProseMirror'
);
```

To:

```typescript
const isEditable = target.closest(
  'input, textarea, select, [contenteditable="true"], ' +
  '[role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], ' +
  'button, .tiptap, .ProseMirror'
);
```

This ensures that ALL button clicks within the locked report area -- including "Add", "Delete", and any other action buttons -- are intercepted and trigger the lock dialog. Non-interactive elements (text, headers, scroll areas) remain unaffected so users can still browse the report freely.

### Edge Cases Considered

- **Tab navigation buttons**: The `TabsTrigger` elements are buttons, but they sit inside `TabsList` which is outside the `onClickCapture` target area in the Training and Daily Assessment forms. For InspectionForm, the tabs ARE inside the `<main>` wrapper, so we need to exclude tab triggers. We will add an exclusion for elements matching `[role="tab"]` to preserve tab navigation in locked mode.
- **Dropdown menu triggers**: The "more options" button on report cards uses a dropdown -- these are also buttons. However, the lock container only wraps the form content area, not the header, so these remain unaffected.
- **Photo gallery interactions**: Photo galleries already receive `readOnly={effectiveReadOnly}`, so they are properly locked.

### Updated Selector (Final)

```typescript
const isEditable = target.closest(
  'input, textarea, select, [contenteditable="true"], ' +
  '[role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], ' +
  'button, .tiptap, .ProseMirror'
);

// Allow tab navigation in locked mode
const isTabTrigger = target.closest('[role="tab"]');
if (!isEditable || isTabTrigger) return;
```

### What is NOT Changing

- No backend or database changes
- No changes to child component APIs (no new readOnly props needed)
- No changes to the CompletionLockDialog component itself
- The CSS `.completion-locked` visual styling remains unchanged
- Photo capture/gallery lock behavior remains unchanged (already works correctly)

