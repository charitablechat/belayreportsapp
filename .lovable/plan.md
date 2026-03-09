

## Glassmorphism Headers — Across All Pages

**Goal**: Apply the same frosted-glass aesthetic used on the Dashboard header to every `<header>` element in the app.

**Reference style** (from Dashboard.tsx):
```
border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5
```

### Files to Update

| File | Current Style | Notes |
|------|--------------|-------|
| `src/pages/InspectionForm.tsx` | `border-b bg-card sticky top-0 z-20` | Keep sticky + z-20 |
| `src/pages/TrainingForm.tsx` | `border-b bg-card sticky top-0 z-20` | Keep sticky + z-20 |
| `src/pages/DailyAssessmentForm.tsx` | `border-b bg-card sticky top-0 z-20` | Keep sticky + z-20 |
| `src/pages/Capabilities.tsx` | `border-b bg-card sticky top-0 z-10` | Keep sticky + z-10 |
| `src/pages/NewInspection.tsx` | `border-b bg-card` | Non-sticky |
| `src/pages/NewTraining.tsx` | `border-b bg-card` | Non-sticky |
| `src/pages/NewDailyAssessment.tsx` | `border-b bg-card` | Non-sticky |
| `src/pages/Profile.tsx` | `border-b bg-card` | Non-sticky |
| `src/pages/Install.tsx` | `border-b bg-background/95 backdrop-blur ...` | Already partial glass; unify |

**9 files**, one class swap each. Replace `border-b bg-card` with `border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5` while preserving any existing `sticky`, `top-0`, and `z-*` classes.

No functional or data-flow changes -- purely cosmetic className updates on `<header>` elements.

