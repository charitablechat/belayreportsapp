

# Always-Green Glassmorphism "Invoiced" Button

## Change
Apply the green glassmorphism styling to the Invoiced button at all times (not conditionally on `isInvoiced`). When toggled on, use a stronger intensity to distinguish the active state.

### Files: `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`

**Current** (green only when `isInvoiced` is true):
```
className={isInvoiced ? "bg-emerald-500/15 backdrop-blur-md ..." : ""}
```

**New** (always green, stronger when active):
```
className={cn(
  "bg-emerald-500/10 backdrop-blur-md border-emerald-400/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.15)] hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300",
  isInvoiced && "bg-emerald-500/25 shadow-[0_0_16px_rgba(16,185,129,0.3)] animate-pulse-calm"
)}
```

- **Default (not yet invoiced):** Subtle green glass — always visible as a green-tinted button.
- **Active (invoiced):** Stronger green glow + calm pulse animation to indicate it's been marked.

Same change in all three form files. No other changes needed.

