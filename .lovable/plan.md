

# Refine Completion Lock: Browse Freely, Block Only Edits

## Problem

The current "deny-list" approach intercepts **every click and pointer event** on the entire form container. This means:
- Tapping to scroll on mobile triggers the lock dialog
- Expanding/collapsing accordion sections triggers the lock dialog
- Selecting text to copy triggers the lock dialog
- Clicking anywhere that isn't explicitly marked `data-lock-exempt` is blocked

Users cannot freely browse a completed report without constant interruptions.

## Solution: Switch from Deny-List to Allow-List (Target Editable Elements Only)

Instead of blocking everything and exempting navigation, we **allow everything** and only intercept clicks on **editable elements** (inputs, textareas, selects, dropdowns, checkboxes, switches, buttons that trigger edits).

### UX Rationale

- **Reading is the primary use case** for completed reports -- users review, reference, and audit content far more than they edit it.
- The lock dialog should be a **speed bump for intentional edits**, not a barrier to viewing.
- A persistent visual indicator (the green terminal banner) communicates locked status without interrupting flow.

## Technical Changes

### 1. Replace deny-list handler with allow-list handler (all 3 form pages)

**Current behavior** (deny-list -- blocks everything):
```typescript
const handleLockedFieldClick = useCallback((e) => {
  if (!isCompletionLocked) return;
  const target = e.target as HTMLElement;
  const isExempt = target.closest('[role="tab"], [data-nav], [data-lock-exempt], [role="tablist"]');
  if (isExempt) return;
  e.preventDefault();
  e.stopPropagation();
  setShowCompletionLockDialog(true);
}, [isCompletionLocked]);
```

**New behavior** (allow-list -- only blocks editable elements):
```typescript
const handleLockedFieldClick = useCallback((e: React.MouseEvent | React.PointerEvent) => {
  if (!isCompletionLocked) return;
  const target = e.target as HTMLElement;

  // Only intercept clicks on editable/interactive form elements
  const isEditable = target.closest(
    'input, textarea, select, [contenteditable="true"], ' +
    '[role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], ' +
    'button[data-editable], .tiptap, .ProseMirror'
  );

  if (!isEditable) return; // Allow all non-editable interactions (scroll, expand, copy, navigate)

  e.preventDefault();
  e.stopPropagation();
  setShowCompletionLockDialog(true);
}, [isCompletionLocked]);
```

This means:
- Scrolling, tapping, text selection -- all pass through freely
- Accordion/collapsible sections -- open and close without interruption
- Tab navigation -- works as before
- Photo gallery viewing -- unblocked
- Clicking an input, dropdown, checkbox, rich text editor, or switch -- triggers the lock dialog

### 2. Add visual "locked" styling to editable fields (CSS)

When a report is completion-locked, editable fields should look visually muted/locked without needing a dialog. Add a CSS class that applies to form containers when locked:

```css
/* Subtle visual lock indicator on editable fields */
.completion-locked input,
.completion-locked textarea,
.completion-locked select,
.completion-locked [contenteditable="true"],
.completion-locked .tiptap,
.completion-locked [role="combobox"],
.completion-locked [role="switch"],
.completion-locked [role="checkbox"] {
  opacity: 0.7;
  cursor: not-allowed;
  pointer-events: auto; /* Keep pointer events so our handler can intercept */
}
```

### 3. Add `completion-locked` class to form container (all 3 form pages)

On the `div` that has `onClickCapture`, conditionally add the class:

```tsx
<div 
  onClickCapture={handleLockedFieldClick} 
  onPointerDownCapture={handleLockedFieldClick}
  className={cn("container mx-auto px-4 py-8", isCompletionLocked && "completion-locked")}
>
```

### 4. Remove `data-lock-exempt` attributes that are no longer needed

Since the new approach allows everything by default, explicit exemptions on navigation elements are no longer necessary. These can be cleaned up for code hygiene.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Replace deny-list handler with allow-list; add `completion-locked` class |
| `src/pages/TrainingForm.tsx` | Same handler replacement and class addition |
| `src/pages/DailyAssessmentForm.tsx` | Same handler replacement and class addition |
| `src/index.css` | Add `.completion-locked` field styling |

## What Does NOT Change

- CompletionLockDialog component (same Retro-Tech Terminal aesthetic)
- The green terminal banner at the top of locked reports
- The unlock confirmation flow (dialog appears, user confirms, `completionLockOverridden` = true)
- Navigation blocking for unsaved changes
- Photo gallery, drag-and-drop, or soft-delete behavior
- Report generation or sync logic

## Interaction Matrix

| Action | Before (Deny-List) | After (Allow-List) |
|--------|--------------------|--------------------|
| Scroll | Blocked (dialog) | Allowed |
| Expand accordion | Blocked (dialog) | Allowed |
| Switch tabs | Allowed | Allowed |
| Select/copy text | Blocked (dialog) | Allowed |
| View photos | Blocked (dialog) | Allowed |
| Click input field | Blocked (dialog) | Blocked (dialog) |
| Click dropdown | Blocked (dialog) | Blocked (dialog) |
| Toggle checkbox | Blocked (dialog) | Blocked (dialog) |
| Click rich text editor | Blocked (dialog) | Blocked (dialog) |

