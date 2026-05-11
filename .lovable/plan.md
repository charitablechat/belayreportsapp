# Fix scroll-to-top on Equipment / Systems / Ziplines inputs

## Root-cause findings

There is **no `<form>` wrapper** around any report (Inspection, Training, Daily Assessment), so the "scroll to top on Enter" symptom is **not** caused by implicit form submission. It is caused by two interacting behaviors:

### Cause A — Smooth-center scroll in `focusNextCell`
`src/lib/table-focus-utils.ts` is invoked on Enter inside every cell input across `EquipmentTable.tsx`, `OperatingSystemsTable.tsx`, and `ZiplinesTable.tsx`. After advancing focus it calls:

```text
next.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
```

`block: 'center'` re-centers the next field in the viewport on **every** Enter press — even when the field is already fully visible. On long tables this produces a pronounced "jump" that users perceive as a reset. When the row's selector finds no matching focusables (which happens when a `DebouncedInput` is wrapped or when the next cell is a rich-text editor or `Popover` trigger), the function falls through to the "next row" branch and re-centers an off-screen element, scrolling far away from where the user was working.

### Cause B — Row remount on `onImmediateSave`
Every cell `onBlur` calls `onImmediateSave`. That handler mutates parent state (and, after a sync, swaps `temp-xxx` row IDs for real UUIDs). Because rows use `key={item.id}`, the row **remounts** when the ID changes. The browser then drops focus to `<body>` and, with `scroll-behavior: smooth` enabled globally, scroll-anchoring sometimes resets the document scroll position toward the top — especially on tablets where the soft keyboard had been pushing the layout.

`GlobalEnterToBlur` already snapshots and restores `scrollY` across two animation frames, but it only fires on the **Enter** path. The **blur-by-tap** path (Cause B) has no such guard, which is why users also see the jump when they simply tap elsewhere.

### Why prior `e.preventDefault()` calls didn't fix it
Each cell's `onKeyDown` already calls `e.preventDefault()`, but `GlobalEnterToBlur` runs first in the capture phase with `stopPropagation()`, so the cell's `onKeyDown` (including its `focusNextCell` call) often never runs from Enter. The visible jump on Enter is therefore Cause A only when the global handler is bypassed (e.g., focus is inside an open combobox `aria-expanded="true"`, or the target is a textarea without Cmd/Ctrl). The blur path is Cause B.

## Fix

Three small, surgical changes — all presentation-layer, no business-logic impact.

### 1. `src/lib/table-focus-utils.ts` — stop the re-centering jump
Change the two `scrollIntoView` calls to:
```text
scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
```
`block: 'nearest'` scrolls only when the target is actually off-screen; `behavior: 'auto'` removes the smooth animation that makes the movement look like a reset. No focus behavior changes.

### 2. New helper `preserveScroll(fn)` in `src/lib/table-focus-utils.ts`
A tiny wrapper that snapshots `window.scrollX/scrollY`, invokes `fn()`, and restores scroll across two `requestAnimationFrame`s — mirroring what `GlobalEnterToBlur` already does. Reused everywhere `onImmediateSave` runs.

```text
export function preserveScroll<T>(fn: () => T): T {
  const x = window.scrollX, y = window.scrollY;
  const result = fn();
  requestAnimationFrame(() => {
    window.scrollTo(x, y);
    requestAnimationFrame(() => window.scrollTo(x, y));
  });
  return result;
}
```

### 3. Wrap blur handlers in `EquipmentTable.tsx`, `OperatingSystemsTable.tsx`, `ZiplinesTable.tsx`
Replace bare `onBlur={onImmediateSave}` with `onBlur={() => preserveScroll(() => onImmediateSave?.())}` on every cell input in those three files. Same for the custom blur callbacks (production year normalizer, divider text, etc.) and the Enter `onKeyDown` paths — wrap the `onImmediateSave?.()` call there too, so even if the row remounts after save, the page lands where it started.

No other files change. `GlobalEnterToBlur`, `useEnterToBlur`, and `useKeyboardAvoidance` already handle scroll correctly and are left alone.

## Verification

1. **Vitest**: add a focused unit test on `preserveScroll` (mock `window.scrollTo`, assert it is called twice with the saved coords across two rAF ticks).
2. **Browser preview at 820×1180 (tablet) and 1366×768 (desktop)** on `/inspection/:id`:
   - Scroll halfway down the Equipment list, tap a cell, type, press Enter → scroll stays put, focus advances to next cell.
   - Same flow on Ziplines and Operating Systems tabs.
   - Tap an input, then tap blank space (blur without Enter) → scroll stays put.
   - Open the Equipment type combobox on a populated row → no scroll movement (was already fixed in the prior tablet-edit work; this change does not touch combobox code).
3. **Existing regression tests** for combobox edit persistence must still pass (`bunx vitest run` on the three test files added previously).

## Out of scope

- No business-logic / save-pipeline changes.
- No changes to combobox, rich-text editor, or keyboard-avoidance behavior.
- No changes to `GlobalEnterToBlur` / `useEnterToBlur` (already correct).
- No changes to `useScrollRestoration` (that handles route changes, not in-form interaction).
