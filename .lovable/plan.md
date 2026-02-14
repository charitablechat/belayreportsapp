

# Conditional UI/UX for Locked Reports -- Minimal Brutalism

## Current Problem

The existing `CompletionLockOverlay` renders an invisible `absolute inset-0` div over the entire report content area. This blocks **all** interaction -- including scrolling, tab switching, and viewing -- forcing the unlock dialog on any click. Users cannot freely browse completed reports without first unlocking them.

## Solution Overview

Replace the blanket overlay approach with a field-level interception strategy. Locked reports render all data as static read-only text. Clicking any editable field triggers a Minimal Brutalist warning dialog. Only after confirming does the UI transition to interactive inputs.

## Implementation Details

### 1. Restyle CompletionLockDialog to Minimal Brutalism

**File: `src/components/CompletionLockDialog.tsx`**

Replace the standard AlertDialog styling with Minimal Brutalism aesthetic:
- Pure black background (`bg-black`)
- Sharp borders (`border-2 border-amber-500`)
- Monospace font (`font-mono`)
- High-contrast amber/white text
- Direct, stark messaging: "REPORT LOCKED" with a warning icon
- Buttons: amber outline for "Cancel", solid amber for "Unlock & Edit"

Remove the `CompletionLockOverlay` component entirely -- it will no longer be needed.

### 2. Remove CompletionLockOverlay from All Three Forms

**Files:**
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`

In each form:
- Remove the `<CompletionLockOverlay>` wrapper around the main content area
- The `effectiveReadOnly` prop is already passed to all child components -- this already renders fields as disabled/read-only when locked
- The `CompletionLockDialog` remains, triggered when users click on locked fields

### 3. Add Click Interception on Editable Fields

The `effectiveReadOnly` boolean already controls whether fields are interactive. When `isCompletionLocked` is true, `effectiveReadOnly` is true, so all fields are already rendered as disabled inputs.

Add an `onClickCapture` handler on the main content container that detects clicks on editable elements (inputs, textareas, selects, checkboxes, rich-text editors) and triggers the unlock dialog:

```typescript
const handleLockedFieldClick = useCallback((e: React.MouseEvent) => {
  if (!isCompletionLocked) return;
  
  const target = e.target as HTMLElement;
  const isEditableField = target.closest(
    'input, textarea, select, [role="checkbox"], [role="combobox"], ' +
    '[contenteditable], .tiptap, button:not([data-nav])'
  );
  
  if (isEditableField) {
    e.preventDefault();
    e.stopPropagation();
    setShowCompletionLockDialog(true);
  }
}, [isCompletionLocked]);
```

Applied to the main content wrapper:
```tsx
<main onClickCapture={handleLockedFieldClick} className="...">
```

This preserves scrolling, tab navigation, and general browsing while intercepting only edit-intent clicks.

### 4. Add Visual Lock Indicator

Add a persistent but non-blocking banner at the top of locked reports:

```tsx
{isCompletionLocked && (
  <div className="border-2 border-amber-500/60 bg-black/90 text-amber-400 
                  font-mono text-xs px-4 py-2 flex items-center gap-2 mb-4">
    <Lock className="h-3.5 w-3.5" />
    <span>LOCKED -- Click any field to unlock for editing</span>
  </div>
)}
```

## Files Changed

1. **`src/components/CompletionLockDialog.tsx`** -- Restyle dialog to Minimal Brutalism; remove `CompletionLockOverlay` export
2. **`src/pages/InspectionForm.tsx`** -- Remove overlay wrapper; add `onClickCapture` handler; add lock banner
3. **`src/pages/TrainingForm.tsx`** -- Same changes
4. **`src/pages/DailyAssessmentForm.tsx`** -- Same changes

## What Stays the Same

- `effectiveReadOnly` logic (already makes fields non-interactive)
- `completionLockOverridden` state management
- `useUnsavedChanges` only activates when lock is overridden
- All RLS policies and permissions are unchanged
- `useReportEditPermission` hook remains untouched

