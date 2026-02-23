

## Add Mobile Refresh Button to Completed Report Pages

### What's Changing

A new **Refresh** button (using the `RefreshCw` icon) will be added **immediately to the left** of the existing "Generate Report" button on all three completed report pages. This button will only be visible on **mobile view** and will call the same report generation handler as the existing button -- effectively allowing users to quickly re-trigger report generation.

### Placement

On mobile, the action bar will show:

```text
[ (refresh icon) ] [ (file icon) ]
```

The refresh button is a compact icon-only button using `variant="outline"` and matching the existing button sizing.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add a mobile-only `RefreshCw` icon button before the Generate Report button (inside the `inspection?.status === 'completed'` block, ~line 2332) |
| `src/pages/TrainingForm.tsx` | Add a mobile-only `RefreshCw` icon button before the Generate Report button (inside the `training?.status === 'completed'` block, ~line 1222) |
| `src/pages/DailyAssessmentForm.tsx` | Add a mobile-only `RefreshCw` icon button before the Generate Report button (inside the `assessment?.status === 'completed'` block, ~line 1321) |

### Technical Details

Each refresh button will:
- Use `RefreshCw` from lucide-react (already imported in InspectionForm; needs import in Training and DailyAssessment)
- Be wrapped in a condition: only render when `isMobile` / `isMobileView` is true
- Call the same handler as Generate Report (`handleGenerateHTML` / `handleGenerateReport`)
- Share the same `disabled` state as the Generate Report button
- Use `variant="ghost"` with `size="icon"` for a compact footprint
- Show a spinning animation on the icon while generating

**InspectionForm.tsx** (~line 2332, before the existing TooltipProvider):
```tsx
{isMobileView && (
  <Button
    variant="ghost"
    size="icon"
    onClick={handleGenerateHTML}
    disabled={generatingHtml || !isOnline}
    className="h-9 w-9"
  >
    <RefreshCw className={cn("w-4 h-4", generatingHtml && "animate-spin")} />
  </Button>
)}
```

**TrainingForm.tsx** (~line 1222, before the existing Generate Report Button):
- Add `RefreshCw` to the lucide-react import
```tsx
{isMobile && (
  <Button
    variant="ghost"
    size="icon"
    onClick={handleGenerateHTML}
    disabled={isGeneratingHTML || !isOnline}
    className="h-9 w-9"
  >
    <RefreshCw className={cn("w-4 h-4", isGeneratingHTML && "animate-spin")} />
  </Button>
)}
```

**DailyAssessmentForm.tsx** (~line 1321, before the existing Generate Report Button):
- Add `RefreshCw` to the lucide-react import
```tsx
{isMobileView && (
  <Button
    variant="ghost"
    size="icon"
    onClick={handleGenerateReport}
    disabled={generating}
    className="h-9 w-9"
  >
    <RefreshCw className={cn("w-4 h-4", generating && "animate-spin")} />
  </Button>
)}
```

### What's NOT Changing
- No changes to the generate report logic itself
- Desktop view remains unchanged (refresh button is mobile-only)
- Button styling follows existing patterns (ghost variant, icon size)
- No new dependencies required
