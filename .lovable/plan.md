

# Glassmorphism Green "Invoiced" Button — Admin/Super Admin Only

## Confirmation
The "Invoiced" button is **already** gated behind `{isAdmin && report?.status === 'completed'}` in all three forms. Regular users never see it. The styling change will only affect this admin-visible button.

## Changes

### 1. `src/pages/InspectionForm.tsx` (line 2783)
### 2. `src/pages/TrainingForm.tsx` (line 1614)
### 3. `src/pages/DailyAssessmentForm.tsx` (line 1675)

Same change in all three — replace the `className` on the Invoiced button:

**Current:**
```
className={isInvoiced ? "text-destructive border-destructive hover:text-destructive" : ""}
```

**New:**
```
className={isInvoiced
  ? "bg-emerald-500/15 backdrop-blur-md border-emerald-400/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)] hover:bg-emerald-500/25 hover:text-emerald-700 dark:hover:text-emerald-300 animate-pulse-calm"
  : ""}
```

This gives a frosted green glass look with a calm pulse animation when marked as invoiced. The button remains invisible to non-admin users — no visibility logic needs to change.

