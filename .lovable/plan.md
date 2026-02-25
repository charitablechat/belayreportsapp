

## Match Save Button Styling Across All Three Forms on Mobile

### Summary

The Save button on mobile in `DailyAssessmentForm` and `TrainingForm` currently shows only an icon (no text) and wraps a `Loader2` spinner in a conditional block. The `InspectionForm` Save button shows the word **"Save"** on mobile alongside the icon, and renders its content without a spinner wrapper. This plan aligns all three.

### Differences Found

| Aspect | InspectionForm (reference) | DailyAssessmentForm | TrainingForm |
|--------|---------------------------|---------------------|--------------|
| Mobile text | `"Save"` (or `"..."` when saving) | `""` (empty) | `""` (empty) |
| Spinner | No Loader2 -- text changes to `"..."` | Loader2 spinner replaces content | Loader2 spinner replaces content |
| Desktop text | `"Save Progress"` / `"Saving..."` / `"Save Locally"` | `"Save Progress"` | `"Save Progress"` |

### Changes

**1. `src/pages/DailyAssessmentForm.tsx` (lines 1338-1352)**

Replace the current conditional spinner block with the InspectionForm pattern:

```tsx
<Button 
  variant="outline"
  size={isMobileView ? "default" : "sm"} 
  onClick={handleSaveProgress} 
  disabled={saving || submitting}
>
  <Save className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
  {isMobileView ? (saving ? "..." : "Save") : (saving ? "Saving..." : "Save Progress")}
</Button>
```

**2. `src/pages/TrainingForm.tsx` (lines 1241-1255)**

Same treatment:

```tsx
<Button 
  variant="outline" 
  size={isMobile ? "default" : "sm"} 
  onClick={saveTraining} 
  disabled={isSaving || !isOnline}
>
  <Save className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
  {isMobile ? (isSaving ? "..." : "Save") : (isSaving ? "Saving..." : "Save Progress")}
</Button>
```

### Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `src/pages/DailyAssessmentForm.tsx` | 1338-1352 | Remove Loader2 conditional, add "Save" mobile text matching InspectionForm |
| `src/pages/TrainingForm.tsx` | 1241-1255 | Remove Loader2 conditional, add "Save" mobile text matching InspectionForm |

No changes needed to `InspectionForm.tsx` -- it is the reference.
