

## Fix: Text Not Wrapping in Portrait Mode on Mobile/Tablet

### Problem
The Equipment table's desktop grid view uses an `md:` breakpoint (768px), meaning tablets in portrait mode (~768-1024px) display the cramped desktop grid instead of the mobile card layout. The grid's minimum width is ~846px, causing text truncation in columns like "Type" and "Manufacture Year(s)".

### Fix

**`src/components/inspection/EquipmentTable.tsx`** — Change the responsive breakpoint from `md:` to `lg:` (1024px) for the desktop/mobile view toggle. This ensures tablets in portrait always get the spacious card layout.

Changes:
1. **Line 373**: `hidden md:block` → `hidden lg:block` (desktop grid)
2. **Line 545**: `md:hidden` → `lg:hidden` (mobile cards)
3. **Line 354**: Card header `md:` flex/padding classes → `lg:` equivalents
4. **Line 371**: CardContent padding `md:px-6` → `lg:px-6`

This is a minimal, targeted fix — the mobile card view already handles text wrapping correctly with full-width inputs and proper label/value stacking. The only issue is that devices between 768-1024px are getting the desktop grid when they should get the card view.

### Files Modified
- `src/components/inspection/EquipmentTable.tsx` (breakpoint change, ~6 line edits)

