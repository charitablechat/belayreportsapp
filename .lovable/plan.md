

# Fix: Hardware Back Button Navigates Through Report Tabs on Mobile

## Problem

On mobile, pressing the hardware back button while inside a report form (Inspection, Training, Daily Assessment) exits the entire report. This is because the global `popstate` handler in `App.tsx` processes the event — it either calls `navigate(-1)` (leaving the form) or redirects to `/dashboard`. It has no awareness of the tab-based navigation within report forms.

**Expected behavior:** Back button should go to the previous tab within the report. Only when on the first tab should it trigger the "save before leave" dialog.

## Solution

Use `history.pushState` to create a history entry each time the user changes tabs within a form. Then, add a form-level `popstate` listener that intercepts the back button to navigate to the previous tab instead of leaving the page.

### Mechanism

1. **On tab change**, push a history state entry: `history.pushState({ reportTab: tabName }, "")`
2. **On popstate** (hardware back), check if the event state has `reportTab` — if so, set the current tab to the previous tab in the order. If already on the first tab, show the leave dialog.
3. **The App.tsx global handler** already skips when `isOverlayActive()` is true. We'll extend `navigation.ts` with a similar pattern: a `reportTabActive` flag that the global handler checks to skip processing.

### Files Modified

**`src/lib/navigation.ts`** — Add `reportTabActive` flag (similar to `overlayActive`):
- `setReportTabActive(active: boolean)` / `isReportTabActive(): boolean`

**`src/App.tsx`** — Add check for `isReportTabActive()` in the popstate handler, returning early so the form handler takes precedence.

**`src/pages/InspectionForm.tsx`** — Add `useEffect` that:
- Sets `reportTabActive = true` on mount, `false` on unmount
- Pushes history state on tab changes
- Listens for `popstate` to navigate tabs backward or show leave dialog

**`src/pages/TrainingForm.tsx`** — Same pattern as InspectionForm.

**`src/pages/DailyAssessmentForm.tsx`** — Same pattern as InspectionForm.

### Technical Detail

```text
Tab history stack (InspectionForm example):

User enters form → push { reportTab: "details" }
User clicks Equipment tab → push { reportTab: "equipment" }
User clicks Standards tab → push { reportTab: "standards" }

Hardware back press:
  popstate fires → state has reportTab → setCurrentTab("equipment")
Another back press:
  popstate fires → state has reportTab → setCurrentTab("details")  
Another back press:
  popstate fires → no reportTab in state → show leave dialog
```

This is the same pattern already used for overlays (lightbox). The form owns the history entries it pushed and cleans up on unmount.

