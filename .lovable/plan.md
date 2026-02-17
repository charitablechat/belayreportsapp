

# Fix: Lock Dialog Not Triggering (Dual-Mechanism Conflict)

## Root Cause

There are **two competing click-interception mechanisms** that cancel each other out:

1. **`onClickCapture` on `<main>`** (line 2195 in InspectionForm) - Fires in the capture phase and checks if `e.target` matches editable field selectors (`input, textarea, select, ...`)

2. **`pointerEvents: 'none'` wrapper** (line 2261) + **overlay div** (line 2256-2259) - Blocks ALL pointer events on form children, with an overlay div meant to catch clicks instead

The conflict: When `pointerEvents: 'none'` is active, clicks never reach the actual form elements (inputs, selects, textareas). Instead, `e.target` becomes the overlay div or wrapper div. The `onClickCapture` handler fires on `<main>`, but the target is NOT an `input`, `textarea`, or `select` -- it's a generic `div`. So `isEditableField` evaluates to `null`, and the dialog never opens.

The overlay's own `onClick` (line 2258) should work as a fallback, but because `onClickCapture` fires first in the capture phase and does NOT call `stopPropagation()` when it doesn't match, the event continues. However, the overlay only covers the `relative` parent's bounding box, which can be inconsistent with dynamically-sized tab content.

**In summary**: `pointerEvents: 'none'` prevents the selector-based handler from identifying editable fields, and the overlay fallback has sizing gaps.

## Solution

Remove the dual mechanism. Switch the `onClickCapture` handler to a **deny-list approach**: when `isCompletionLocked`, intercept ALL clicks unless the target is a tab trigger or navigation element. Remove the overlay div and `pointerEvents: 'none'` wrapper entirely.

## Changes

### 1. `src/pages/InspectionForm.tsx`

**Update `handleLockedFieldClick`** (lines 132-145):
```typescript
const handleLockedFieldClick = useCallback((e: React.MouseEvent) => {
  if (!isCompletionLocked) return;
  const target = e.target as HTMLElement;
  // Allow only navigation elements to pass through
  const isExempt = target.closest(
    '[role="tab"], [data-nav], [data-lock-exempt], [role="tablist"]'
  );
  if (isExempt) return;
  e.preventDefault();
  e.stopPropagation();
  setShowCompletionLockDialog(true);
}, [isCompletionLocked]);
```

**Remove overlay and pointer-events wrapper** (lines 2254-2261):
Remove the `<div className="relative">`, the `absolute inset-0 z-10` overlay div, and the `pointerEvents: 'none'` wrapper. The `TabsContent` elements should render directly without these wrappers.

### 2. `src/pages/TrainingForm.tsx`

Same two changes:
- Update `handleLockedFieldClick` (lines 98-111) to the deny-list approach
- Remove the overlay/pointer-events wrapper (lines 1121-1128)

### 3. `src/pages/DailyAssessmentForm.tsx`

Same two changes:
- Update `handleLockedFieldClick` (lines 101-114) to the deny-list approach
- Remove the overlay/pointer-events wrapper (lines 1250-1257)

## Why This Works

- **Deny-list vs allow-list**: Instead of trying to match specific editable elements (which fails when `pointerEvents: 'none'` hides them), we block EVERYTHING except navigation tabs
- **Single mechanism**: No competing overlay div or pointer-events wrapper
- **Capture phase**: `onClickCapture` fires before any child handlers, so `stopPropagation()` prevents the click from reaching form controls
- **Tab navigation preserved**: The `[role="tab"]` and `[role="tablist"]` exemptions allow switching between report sections

## What Does NOT Change

- `CompletionLockDialog.tsx` (visual fix already applied)
- Lock state derivation (`isCompletionLocked`, `completionLockOverridden`)
- Lock banner styling
- `useReportEditPermission` hook
- Backend, edge functions, RLS policies

