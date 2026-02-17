

# Fix: Lock Dialog Positioning and Dropdown Bypass

## Issue 1: Dialog Stuck at Bottom of Viewport

**Root cause**: In `CompletionLockDialog.tsx` (line 22), the className includes `relative`:

```
bg-zinc-900 border-double border-4 ... max-w-md relative overflow-hidden ...
```

The base `AlertDialogContent` component applies `fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]` for viewport centering. The `relative` class **overrides `fixed`**, causing the dialog to render inline in the document flow instead of centered in the viewport. This is why it appears cut off at the bottom of the page.

**Fix**: Remove `relative` from `AlertDialogContent`'s className. The scanline overlay and z-20 content still work because the base component's `fixed` positioning creates a stacking context. Change the scanline div to also work within the fixed context.

### `src/components/CompletionLockDialog.tsx`

Replace the entire component with Minimal Brutalist styling per the user's spec:

```tsx
<AlertDialogContent className="bg-zinc-900 border-solid border-2 border-black font-mono max-w-md overflow-hidden shadow-[0_0_60px_rgba(34,197,94,0.6)] backdrop-blur-sm">
  {/* CRT scanline overlay */}
  <div
    className="pointer-events-none absolute inset-0 z-10"
    style={{
      background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.03) 2px, rgba(0,255,0,0.03) 4px)',
    }}
  />
  <AlertDialogHeader className="relative z-20">
    ...existing header content...
  </AlertDialogHeader>
  <AlertDialogFooter className="gap-2 relative z-20">
    ...existing footer content...
  </AlertDialogFooter>
</AlertDialogContent>
```

Changes:
- Remove `relative` (was overriding `fixed` from base component)
- Change `border-double border-4 border-green-500` to `border-solid border-2 border-black` (stark black outlines per Minimal Brutalist spec)
- Add `backdrop-blur-sm` for the subtle blur effect requested
- Keep the green glow shadow for visibility contrast

---

## Issue 2: Dropdown Menus Bypassing Lock

**Root cause**: The `onClickCapture` handler on the main container catches clicks in React's capture phase. However, Radix UI `Select` triggers use `onPointerDown` internally, which fires **before** `onClick`. The capture-phase `onClick` handler runs after the pointer event has already been processed by Radix, allowing the dropdown to open.

**Fix**: Add `onPointerDownCapture` alongside `onClickCapture` on the lock container in all three forms. Pointer events fire before click events, so intercepting at `onPointerDownCapture` blocks Radix from processing the interaction.

### `src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`

Update the `handleLockedFieldClick` callback to also handle pointer events:

```typescript
const handleLockedFieldClick = useCallback((e: React.MouseEvent | React.PointerEvent) => {
  if (!isCompletionLocked) return;
  const target = e.target as HTMLElement;
  const isExempt = target.closest(
    '[role="tab"], [data-nav], [data-lock-exempt], [role="tablist"]'
  );
  if (isExempt) return;
  e.preventDefault();
  e.stopPropagation();
  setShowCompletionLockDialog(true);
}, [isCompletionLocked]);
```

And on the container element, add both capture handlers:

```tsx
<main
  onClickCapture={handleLockedFieldClick}
  onPointerDownCapture={handleLockedFieldClick}
  className="..."
>
```

This ensures that Radix Select triggers, custom dropdowns, and all other pointer-driven interactions are intercepted before they can open portals outside the capture container.

---

## Summary of Changes

| File | Change |
|------|--------|
| `CompletionLockDialog.tsx` | Remove `relative`, update border to `2px solid black`, add `backdrop-blur-sm` |
| `InspectionForm.tsx` | Add `onPointerDownCapture` to main container |
| `TrainingForm.tsx` | Add `onPointerDownCapture` to main container |
| `DailyAssessmentForm.tsx` | Add `onPointerDownCapture` to main container |

## What Does NOT Change
- Lock state derivation logic
- `useReportEditPermission` hook
- Tab navigation exemptions
- Backend, edge functions, RLS policies
- No secrets or API keys exposed
