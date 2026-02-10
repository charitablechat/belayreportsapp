

# Fix Equipment Section: Dropdown Clipping and Production Year Arrows

## Problem 1: Equipment Type Dropdown Shows No Options

The dropdown popover is being **clipped by the table's `overflow-x-auto` container**. Radix popover portals to the body by default, but the visual trigger area and interaction can be disrupted by overflow containers. The data itself is present in the database (20+ equipment type entries confirmed).

**Fix:** Add `overflow-visible` to the table container when any popover is open, or more reliably, ensure the PopoverContent uses a portal with appropriate z-index. The simpler fix is to remove `overflow-x-auto` from the desktop table wrapper since the table uses percentage widths and doesn't actually need horizontal scroll, or set `overflow: visible` so the popover isn't clipped.

### Changes in `src/components/inspection/EquipmentTable.tsx`
- Change the desktop table wrapper from `overflow-x-auto` to `overflow-visible` so the GlobalAutocomplete popover can render above the table boundaries without being clipped.

## Problem 2: Production Year Has Browser Spinner Arrows

The `<Input type="number">` renders native browser up/down spinner arrows. These should be hidden so the field is keyboard-only entry with a number pad.

**Fix:** Change `type="number"` to `type="text"` with `inputMode="numeric"` and `pattern="[0-9]*"`. This gives mobile users a number pad without the spinner arrows, and works consistently across all browsers.

### Changes in `src/components/inspection/EquipmentTable.tsx`
- Desktop row: Update the Production Year `<Input>` (around line 175) — change `type="number"` to `type="text"`, add `inputMode="numeric"` and `pattern="[0-9]*"`
- Mobile card: Update the Production Year `<Input>` (around line 253) — same change
- Both Quantity inputs remain `type="number"` (spinners are acceptable for quantity)

### Changes in `src/index.css`
- Add CSS to globally hide number input spinners as a safety net:
```css
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
}
```

## Summary of File Changes

| File | Change |
|------|--------|
| `src/components/inspection/EquipmentTable.tsx` | Remove `overflow-x-auto` (use `overflow-visible`); change Production Year inputs from `type="number"` to `type="text"` with `inputMode="numeric"` |
| `src/index.css` | Add global CSS to hide number spinner arrows on all number inputs |

