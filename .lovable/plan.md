

## Make Section Tab Bar Sticky on All Three Report Forms

### Summary

Add sticky positioning to the tab navigation bar in all three report forms (InspectionForm, DailyAssessmentForm, TrainingForm) so the category tabs remain fixed at the top of the viewport when scrolling. The screenshot confirms all four tabs (including Summary) should be visible and sticky.

### Changes

**1. `src/pages/InspectionForm.tsx` (line 2460)**

Add sticky classes to the swipe container div:

```tsx
// Before:
<div ref={swipeContainerRef}>

// After:
<div ref={swipeContainerRef} className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm pb-1">
```

**2. `src/pages/DailyAssessmentForm.tsx` (line 1424)**

Same change:

```tsx
// Before:
<div ref={swipeContainerRef}>

// After:
<div ref={swipeContainerRef} className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm pb-1">
```

**3. `src/pages/TrainingForm.tsx` (line 1319)**

Same change:

```tsx
// Before:
<div ref={swipeContainerRef}>

// After:
<div ref={swipeContainerRef} className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm pb-1">
```

### Design Details

- `sticky top-0` -- sticks to top of viewport when scrolled past
- `z-30` -- above content, below modals (z-50) and header avatar (z-50)
- `bg-background/95 backdrop-blur-sm` -- semi-transparent background with blur so content scrolling beneath is subtly visible but not distracting
- `pb-1` -- small bottom padding for visual separation from content below
- Max height stays compact (~48-56px) matching existing tab dimensions
- All 4 tabs remain visible (no truncation) on both mobile grid-cols-2/4 and desktop grid-cols-4/7 layouts

### Files to Modify

| File | Line | Change |
|------|------|--------|
| `src/pages/InspectionForm.tsx` | 2460 | Add sticky classes to swipe container div |
| `src/pages/DailyAssessmentForm.tsx` | 1424 | Add sticky classes to swipe container div |
| `src/pages/TrainingForm.tsx` | 1319 | Add sticky classes to swipe container div |

