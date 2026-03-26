

## Fix: Enter Key Moves Focus to Next Column & Keeps View Centered

### Problem

In all report tables (Equipment, Operating Systems, Ziplines), pressing Enter in an input field only triggers `onImmediateSave()` but does **not**:
1. **Prevent default** — the browser may submit a form or move focus unpredictably
2. **Move focus to the next column** — focus either stays put or jumps elsewhere in the DOM
3. **Keep the viewport centered** — `useKeyboardAvoidance` scrolls focused elements to center, but since Enter doesn't direct focus to the right cell, it may jump to an unrelated element

### Fix

#### 1. Create a shared `focusNextCell` utility (`src/lib/table-focus-utils.ts`)

A small helper that, given the current input element:
- Finds the parent row (`[data-row-id]`)
- Collects all focusable inputs/selects in that row (excluding file inputs and delete buttons)
- Finds the current element's index
- Focuses the next one (or wraps to the first input of the next row if at the end)
- Calls `scrollIntoView({ behavior: 'smooth', block: 'center' })` on the newly focused element

#### 2. Replace all `onKeyDown` Enter handlers in table components

In **4 files**, replace the pattern:
```ts
onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
```
with:
```ts
onKeyDown={(e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    onImmediateSave?.();
    focusNextCell(e.currentTarget);
  }
}}
```

**Files to update:**
- `src/components/inspection/EquipmentTable.tsx` (~10 instances, desktop + mobile)
- `src/components/inspection/ZiplinesTable.tsx` (~8 instances)
- `src/components/inspection/OperatingSystemsTable.tsx` (check for similar patterns)
- `src/components/inspection/DebouncedInput.tsx` — no change needed (it passes `onKeyDown` through)

#### 3. Update `useKeyboardAvoidance` scroll target

Change `scrollIntoView` from `block: 'center'` to ensure it fires consistently when focus moves within the same row (currently it only fires on `focusin` with a 300ms delay which works for this).

### Technical Details

The `focusNextCell` function:
```ts
export function focusNextCell(current: HTMLElement) {
  const row = current.closest('[data-row-id]');
  if (!row) return;
  
  const focusables = Array.from(row.querySelectorAll<HTMLElement>(
    'input:not([disabled]):not([type="file"]), textarea, [contenteditable="true"], [tabindex="0"], select'
  ));
  
  const idx = focusables.indexOf(current);
  const next = focusables[idx + 1];
  
  if (next) {
    next.focus();
    next.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    // At end of row — move to next row's first input
    const allRows = Array.from(row.parentElement?.querySelectorAll('[data-row-id]') ?? []);
    const rowIdx = allRows.indexOf(row);
    const nextRow = allRows[rowIdx + 1];
    if (nextRow) {
      const firstInput = nextRow.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="file"]), textarea, [contenteditable="true"], [tabindex="0"]'
      );
      if (firstInput) {
        firstInput.focus();
        firstInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}
```

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/table-focus-utils.ts` | **New** — `focusNextCell` helper |
| `src/components/inspection/EquipmentTable.tsx` | Replace ~10 Enter handlers |
| `src/components/inspection/ZiplinesTable.tsx` | Replace ~8 Enter handlers |
| `src/components/inspection/OperatingSystemsTable.tsx` | Replace Enter handlers if present |

