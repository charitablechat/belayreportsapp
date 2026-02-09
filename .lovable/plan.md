

# Add Border to Active Navigation Tab

## Problem

After softening the navigation bar, the active tab blends in a bit too much. It needs a subtle border or outline to calmly distinguish it from inactive tabs without reverting to the harsh dark theme.

## Change

### File: `src/pages/InspectionForm.tsx` (lines 2121, 2125, 2129, 2133)

Add `data-[state=active]:border data-[state=active]:border-primary/30` to each `TabsTrigger` className. This adds a soft, semi-transparent border around the active tab that reinforces the selection without being loud.

Updated active-state classes on all four triggers:

```
data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold data-[state=active]:border data-[state=active]:border-primary/30
```

## Result

The active tab gets a calm, color-coordinated border that pairs with the existing primary background and shadow, making it clearly stand out while staying visually refined.

