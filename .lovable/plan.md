

# Fix: Lock Dialog Invisible (Black-on-Black + Z-Index Stacking)

## Root Cause (Two Issues)

### Issue 1: Background indistinguishable from overlay
`bg-zinc-950` is `#09090b` — only 3 shades lighter than pure black. The modal overlay behind it is `bg-black/80`. At normal brightness, these are visually identical.

### Issue 2: Scanline overlay covers text content
The CRT scanline div uses `absolute inset-0 z-10`. The `AlertDialogHeader` and `AlertDialogFooter` are in normal document flow with no z-index (z-auto = 0). The scanline layer renders ABOVE the green text and buttons, adding a semi-transparent green tint that further reduces contrast of the already-too-dark content.

## Fix

### `src/components/CompletionLockDialog.tsx`

Three changes to this single file:

1. **Background**: Change `bg-zinc-950` to `bg-zinc-900` (`#18181b`) — visibly distinct from the overlay
2. **Glow**: Increase shadow from `0.4` to `0.6` opacity and `40px` to `60px` spread
3. **Z-index fix**: Add `relative z-20` to `AlertDialogHeader` and `AlertDialogFooter` so text and buttons render ABOVE the z-10 scanline overlay

Updated component:

```tsx
<AlertDialogContent className="bg-zinc-900 border-double border-4 border-green-500 font-mono max-w-md relative overflow-hidden shadow-[0_0_60px_rgba(34,197,94,0.6)]">
  {/* CRT scanline overlay — z-10 */}
  <div className="pointer-events-none absolute inset-0 z-10" style={{...}} />

  {/* Content — z-20, above scanlines */}
  <AlertDialogHeader className="relative z-20">
    ...
  </AlertDialogHeader>
  <AlertDialogFooter className="gap-2 relative z-20">
    ...
  </AlertDialogFooter>
</AlertDialogContent>
```

No other files need to change. The lock mechanism, overlay click handling, and state management are all working correctly — this is purely a visual contrast issue.

## What Changes

| Property | Before | After |
|----------|--------|-------|
| Background | `bg-zinc-950` (#09090b) | `bg-zinc-900` (#18181b) |
| Shadow | `40px`, 0.4 opacity | `60px`, 0.6 opacity |
| Header z-index | none (z-auto) | `relative z-20` |
| Footer z-index | none (z-auto) | `relative z-20` |

## What Does NOT Change
- Lock mechanism and state management
- `onClickCapture` handler and overlay approach in form pages
- Lock banner styling
- Backend, edge functions, RLS policies
- No auth tokens or secrets in frontend

