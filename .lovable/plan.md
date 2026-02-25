

## Single-Line Tab Bar for InspectionForm on Mobile

### Summary
Change the InspectionForm's tab bar from a 2-column grid (2 rows) to a 4-column grid (1 row) on mobile, matching the desktop layout.

### Changes

**`src/pages/InspectionForm.tsx` (line 2461)**

1. Change `grid-cols-2` to `grid-cols-4` so all 4 tabs sit on one line on mobile
2. Change each TabsTrigger from `flex-col` to `flex-row` on mobile so the icon and label are side-by-side (saves vertical space)
3. Hide the icons on mobile (`hidden lg:block`) to give the text more room in the compact single-row layout

### Technical Detail

```tsx
// TabsList: grid-cols-2 -> grid-cols-4
<TabsList className="grid grid-cols-4 w-full gap-1 lg:gap-0 h-auto p-1.5 lg:p-1 ...">

// Each TabsTrigger: flex-col lg:flex-row -> flex-row, hide icon on mobile
<TabsTrigger className="... text-xs lg:text-sm py-1.5 lg:py-2 flex flex-row items-center gap-1 lg:gap-1.5 ...">
  <Settings className="h-3.5 w-3.5 hidden lg:block" />
  <span>Systems</span>
</TabsTrigger>
```

### Files to Modify

| File | Line | Change |
|------|------|--------|
| `src/pages/InspectionForm.tsx` | 2461 | `grid-cols-2` to `grid-cols-4` |
| `src/pages/InspectionForm.tsx` | 2462-2477 | Hide icons on mobile, use `flex-row` always, reduce vertical padding |

