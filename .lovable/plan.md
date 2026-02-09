
# Soften the Category Navigation Bar

## Problem

The category navigation bar (Systems - Ziplines, Equipment, Operations Criteria, Summary) uses a harsh dark `bg-zinc-800` background with `border-zinc-700`, creating a heavy, high-contrast block that feels jarring against the light page background.

## Solution

Replace the dark theme with a soft, muted light palette that matches the polished field-card styling already used in the header.

### File: `src/pages/InspectionForm.tsx` (line 2120-2136)

**TabsList container** (line 2120):
- Change `bg-zinc-800 border-b-2 border-zinc-700` to `bg-muted/50 border border-border/50`
- This gives a soft gray background consistent with the field cards above

**All four TabsTrigger elements** (lines 2121, 2125, 2129, 2133):
- Change `text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700` to `text-muted-foreground hover:text-foreground hover:bg-accent/50`
- Keep the active state: `data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold`

### Result

- Container: light muted background with subtle border -- calm and professional
- Inactive tabs: soft gray text that darkens on hover with a gentle highlight
- Active tab: keeps the bold primary-colored selection for clear navigation
- Matches the refined field-card aesthetic throughout the header
