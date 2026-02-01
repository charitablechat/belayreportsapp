
# Mobile Layout Audit & Fix Plan

## Executive Summary
A comprehensive audit of the mobile viewport (< 768px) has identified critical layout issues across multiple inspection form components. The most severe issues are in the **EquipmentTable** component, with additional problems found in other mobile card views.

---

## Critical Issues Identified

### 1. EquipmentTable Mobile Card View (HIGH PRIORITY)

**File:** `src/components/inspection/EquipmentTable.tsx`

**Problems:**
- **Overlapping delete button**: The absolute-positioned delete button (`absolute top-2 right-2`) overlaps with the content area that only has `pr-8` (32px) padding, causing text to collide with the button
- **Insufficient card padding**: Card uses `p-4` which is too tight for mobile data entry
- **Label text wrapping issues**: Long label text like "Comments and/or Required Changes" can wrap awkwardly
- **Nested Card within Card**: Creates visual confusion and inconsistent shadows

**Fixes:**
- Increase right padding to `pr-12` (48px) to properly accommodate the delete button
- Increase card padding to `p-5` for better touch targets
- Truncate long labels or use shorter mobile-specific labels
- Remove inner Card wrapper and use styled `div` instead

### 2. ZiplinesTable Mobile Card View

**File:** `src/components/inspection/ZiplinesTable.tsx`

**Problems:**
- Same overlapping delete button issue as EquipmentTable
- Complex 2-column grid layout can cause text squishing on very small screens (320px)
- Labels like "Braking System" compete for space in grid cells

**Fixes:**
- Increase right padding to `pr-12`
- Add `min-w-0` to grid children to prevent content overflow
- Add responsive breakpoint for single-column on smallest screens

### 3. OperatingSystemsTable Mobile Card View

**File:** `src/components/inspection/OperatingSystemsTable.tsx`

**Problems:**
- Identical overlapping button issue
- Consistent with other tables but needs same fixes

**Fixes:**
- Increase right padding to `pr-12`
- Add consistent padding improvements

### 4. SummarySection Mobile Card View

**File:** `src/components/inspection/SummarySection.tsx`

**Problems:**
- Retirement guidelines cards have adequate spacing but could benefit from improved text hierarchy

**Status:** Minor issue, lower priority

### 5. StandardsTable Mobile Card View

**File:** `src/components/inspection/StandardsTable.tsx`

**Problems:**
- Badge can overflow on very narrow screens when combined with checkbox labels

**Fixes:**
- Add `flex-wrap` to the status row
- Ensure badge has proper `shrink-0` to prevent squishing

### 6. PhotoGallery Grid

**File:** `src/components/PhotoGallery.tsx`

**Problems:**
- 2-column grid on mobile can make captions hard to read
- Delete button visibility on mobile is correct (always visible)

**Status:** Acceptable, no critical fixes needed

### 7. HistoryAutocomplete Popover

**File:** `src/components/HistoryAutocomplete.tsx`

**Problems:**
- Fixed popover width of 300px doesn't adapt to narrow mobile screens
- Can extend beyond viewport edge on 320px screens

**Fixes:**
- Use responsive width: `w-[calc(100vw-2rem)] sm:w-[300px]` with `max-w-[300px]`

### 8. RichTextEditor Toolbar

**File:** `src/components/ui/rich-text-editor.tsx`

**Problems:**
- Toolbar buttons are appropriately sized
- Editor min-height of 80px is sufficient for mobile

**Status:** No critical issues

---

## Implementation Details

### Priority 1: EquipmentTable.tsx (Critical)

```tsx
// Line 199: Change from p-4 to p-5, and wrap differently
<Card key={index} className="p-5 relative border-l-4 border-l-primary/20">
  <Button
    variant="ghost"
    size="sm"
    onClick={() => setItemToDelete({ item, name: item.equipment_type || "this equipment" })}
    className="absolute top-3 right-3 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
  >
    <Trash2 className="h-4 w-4" />
  </Button>
  {/* Line 208: Change from pr-8 to pr-12 for proper button clearance */}
  <div className="space-y-4 pr-12">
    ...
  </div>
</Card>
```

**Additional mobile layout improvements:**
- Add `truncate` or `line-clamp-1` to labels that may overflow
- Use mobile-friendly label abbreviations where appropriate
- Ensure consistent vertical spacing with `space-y-4` instead of `space-y-3`

### Priority 2: ZiplinesTable.tsx

```tsx
// Mobile card view - increase padding clearance
<Card key={index} className="p-5 relative">
  <Button ... className="absolute top-3 right-3 ..." />
  {/* Change from pr-8 to pr-12 */}
  <div className="space-y-4 pr-12">
    {/* Add min-w-0 to grid children for overflow prevention */}
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0">...</div>
      <div className="min-w-0">...</div>
    </div>
  </div>
</Card>
```

### Priority 3: OperatingSystemsTable.tsx

Same pattern as above - increase `pr-8` to `pr-12` and padding from `p-4` to `p-5`.

### Priority 4: StandardsTable.tsx

```tsx
// Line 115: Add flex-wrap to prevent badge overflow
<div className="flex items-center justify-between pt-2 flex-wrap gap-2">
  <div className="flex items-center gap-4 flex-wrap">
    ...
  </div>
  {/* Badge stays on right, wraps to new line if needed */}
  {standardData.has_documentation === false && (
    <Badge variant="destructive" className="text-xs shrink-0">Missing</Badge>
  )}
</div>
```

### Priority 5: HistoryAutocomplete.tsx

```tsx
// Line 283: Use responsive width
<PopoverContent 
  className="w-[calc(100vw-2rem)] sm:w-[300px] max-w-[300px] p-0" 
  align="start"
  side="bottom"
  sideOffset={4}
>
```

---

## CSS Utility Additions

Add to `src/index.css` for consistent mobile layout patterns:

```css
/* Mobile layout utilities */
@layer utilities {
  /* Prevent text overflow in flex/grid children */
  .mobile-safe-text {
    @apply min-w-0 break-words;
  }
  
  /* Standard mobile card with delete button clearance */
  .mobile-card-with-action {
    @apply p-5 relative;
  }
  
  .mobile-card-with-action > .action-button {
    @apply absolute top-3 right-3;
  }
  
  .mobile-card-with-action > .content-area {
    @apply pr-12 space-y-4;
  }
}
```

---

## Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `src/components/inspection/EquipmentTable.tsx` | **P0** | Fix padding, button positioning, nested card removal |
| `src/components/inspection/ZiplinesTable.tsx` | **P1** | Fix padding, add min-w-0 to grid children |
| `src/components/inspection/OperatingSystemsTable.tsx` | **P1** | Fix padding for consistency |
| `src/components/inspection/StandardsTable.tsx` | **P2** | Add flex-wrap to prevent badge overflow |
| `src/components/HistoryAutocomplete.tsx` | **P2** | Responsive popover width |
| `src/index.css` | **P3** | Add reusable mobile layout utilities |

---

## Testing Checklist

After implementation:
- [ ] EquipmentTable: Delete button no longer overlaps with content
- [ ] EquipmentTable: All form fields accessible without scrolling horizontally
- [ ] ZiplinesTable: Grid layouts don't cause text to overflow
- [ ] OperatingSystemsTable: Consistent spacing with other tables
- [ ] StandardsTable: Badge wraps properly on narrow screens
- [ ] HistoryAutocomplete: Popover stays within viewport on 320px screens
- [ ] All mobile cards have adequate touch target spacing (44px minimum)
- [ ] Test on iPhone SE (320px), iPhone 14 (390px), and larger phones

---

## Design Principles Applied

1. **Consistent Spacing**: Uniform `p-5` padding and `space-y-4` vertical rhythm
2. **Proper Clearance**: 48px (pr-12) clearance for absolute-positioned buttons
3. **Overflow Prevention**: `min-w-0` on flex/grid children, responsive widths on popovers
4. **Touch Targets**: Minimum 44x44px interactive areas per iOS/Android guidelines
5. **Visual Hierarchy**: Clear label/input relationships with adequate spacing
