

# Show Auto-Save Feedback on Mobile Viewports

## Findings

### Auto-Save Logic (Already Working -- No Changes Needed)
The auto-save system is already optimized and fully operational on all screen sizes:

- **Trigger**: 1.5-second debounce after any data change, plus a 10-second interval backup
- **Persistence**: IndexedDB (local-first), then background sync to the cloud
- **Emergency save**: Fires on `visibilitychange` / `pagehide` (tab switch, app close)
- **Safety timeout**: 8-second max to prevent stuck "saving" states

No changes to save logic, timing, or persistence method are needed.

### The Bug: No Visual Feedback on Mobile
All three report forms pass `className="hidden sm:flex"` to `AutoSaveIndicator`, making it completely invisible below 640px. Mobile users get no confirmation that their data is being saved.

## Plan

### 1. Update `AutoSaveIndicator` for Mobile-Friendly Display
Restyle the component to show a compact, icon-only indicator on mobile (already partially implemented with `sm:hidden` / `hidden sm:inline` spans inside the component). The issue is the **parent** hides the entire component.

### 2. Remove `hidden sm:flex` from All Three Forms
Change the className from `"hidden sm:flex"` to `"flex"` in:

| File | Line |
|------|------|
| `src/pages/InspectionForm.tsx` | ~2224 |
| `src/pages/TrainingForm.tsx` | ~1163 |
| `src/pages/DailyAssessmentForm.tsx` | ~1268 |

The component already has responsive internal behavior (icon-only on mobile, icon+text on desktop via `hidden sm:inline` / `sm:hidden` spans), so simply unhiding the wrapper is sufficient.

### 3. Apply Brutalist Glassmorphism Styling to the AutoSaveIndicator
Update `src/components/AutoSaveIndicator.tsx` to add a subtle frosted-glass pill on mobile that matches the Slate 900 / Emerald 400 aesthetic:

- Add `bg-slate-900/60 backdrop-blur-sm border border-white/10 rounded-sm px-2 py-0.5` wrapper on mobile for the terminal look
- Keep the existing desktop inline style unchanged (no background pill)
- Use `font-mono` for the terminal aesthetic consistency

## Files Modified
| File | Change |
|------|--------|
| `src/components/AutoSaveIndicator.tsx` | Add Brutalist glassmorphism mobile styling |
| `src/pages/InspectionForm.tsx` | Change `hidden sm:flex` to `flex` |
| `src/pages/TrainingForm.tsx` | Change `hidden sm:flex` to `flex` |
| `src/pages/DailyAssessmentForm.tsx` | Change `hidden sm:flex` to `flex` |

## What Does NOT Change
- Auto-save debounce timing (1.5s)
- IndexedDB persistence logic
- Emergency save behavior
- Background sync system
- Desktop layout
