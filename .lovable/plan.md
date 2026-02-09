

# Improve Inspection Form Tab Visibility

## Problem
The 4 category tabs (Systems - Ziplines, Equipment, Operations Criteria, Summary) blend into the background. The active tab is barely distinguishable from inactive tabs -- both use very light, low-contrast colors.

## Solution
Apply stronger visual differentiation directly on the `TabsList` and `TabsTrigger` elements in `InspectionForm.tsx`:

**Inactive tabs**: Add a slightly darker text color and a subtle bottom border so they read as clickable navigation items.

**Active tab**: Use a bold primary-colored bottom border (like an underline indicator), primary text color, and a slightly elevated background -- making it immediately obvious which tab is selected.

**Icons**: Active tab icons switch to primary color; inactive icons stay muted.

## Technical Changes

**File: `src/pages/InspectionForm.tsx`** (lines 2058-2074)

1. **TabsList**: Add a visible bottom border and slightly more contrast:
   - Change from default `bg-muted` to `bg-muted/80` with a `border-b-2 border-border`

2. **Each TabsTrigger**: Add active-state styling using Tailwind's `data-[state=active]:` modifier:
   - `data-[state=active]:bg-primary/10` -- light primary tint background
   - `data-[state=active]:text-primary` -- primary color text
   - `data-[state=active]:border-b-2 data-[state=active]:border-primary` -- bold underline indicator
   - `data-[state=active]:font-semibold` -- bolder text weight
   - `text-muted-foreground` on inactive state for clearer contrast with active
   - `hover:text-foreground` for hover feedback

This approach keeps the existing layout intact (grid, icons, responsive labels) while making the tabs significantly more scannable and the active state unmistakable.
