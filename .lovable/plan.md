

## Fix: Global Text Wrapping and Table Overflow for Portrait Mode

### Changes

#### 1. `src/index.css` — Add global text-wrapping and grid-child rules

Add to the `@layer base` section:

```css
/* Prevent text overflow on narrow viewports */
p, span, label, td, th, div, li {
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* Allow grid children to shrink below content size */
.grid > * {
  min-width: 0;
}

/* Ellipsis for inputs and selects that overflow */
input, select {
  text-overflow: ellipsis;
}
```

#### 2. `src/components/ui/card.tsx` — Already has `overflow-hidden`
Line 6 already includes `overflow-hidden`. No change needed.

#### 3. `src/components/inspection/OperatingSystemsTable.tsx` — Update breakpoints `md:` to `lg:`
Same fix as was applied to EquipmentTable:
- Line 126: `px-3 md:px-6` → `px-3 lg:px-6`
- Line 128: `hidden md:block` → `hidden lg:block`
- Line 233: `md:hidden` → `lg:hidden`
- Also update the header flex classes if any use `md:`

#### 4. `src/components/inspection/ZiplinesTable.tsx` — Update breakpoints `md:` to `lg:`
- Line 121: `hidden md:block` → `hidden lg:block`
- Line 238: `md:hidden` → `lg:hidden`
- Update any `md:px-6` or `md:flex-row` classes to `lg:` equivalents

#### 5. `src/components/inspection/EquipmentTable.tsx` — Adjust grid column minima
- Line 39: Update `EQ_GRID_COLS` — ensure Type column uses `minmax(120px, 1fr)` (already correct) and Result column uses `160px` (already correct)

### Files Modified
- `src/index.css` (global CSS rules)
- `src/components/inspection/OperatingSystemsTable.tsx` (breakpoint `md:` → `lg:`)
- `src/components/inspection/ZiplinesTable.tsx` (breakpoint `md:` → `lg:`)

