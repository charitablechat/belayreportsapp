

# Performance Parity: Training & Daily Assessment Forms

The previous audit rounds optimized only `InspectionForm.tsx`. The Training (1,710 lines) and Daily Assessment (1,704 lines) forms have **identical architectural issues** — zero memoization, monolithic structure, and the same auto-save patterns. Here is the gap analysis and fix plan.

---

## Findings

### TrainingForm.tsx — No Memoization At All

- **Auto-save effect** (line 862) depends on `[deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary]` — any change to any section triggers the debounce timer and re-evaluation
- **All 6 child section components** (`DeliveryApproachSection`, `OperatingSystemsSection`, etc.) receive raw state setters (`setDeliveryApproaches`, `setOperatingSystems`, etc.) — every render passes new function references unless wrapped in `useCallback`
- **Save function** (line 851) has a dependency array of 8 items — recreated on every state change, causing the auto-save `useEffect` to re-fire even when the debounce logic hasn't changed
- **No `React.memo`** on any child component — a keystroke in the Summary tab re-renders the Delivery Approach, Operating Systems, etc.

### DailyAssessmentForm.tsx — Same Pattern, 6 Child Tables

- **Auto-save effect** depends on `[beginningOfDay, endOfDay, operatingSystems, equipmentChecks, structureChecks, environmentChecks]`
- **`handleSaveProgress`** dynamically imports `offline-storage` on every save call (line 656) — this `import()` is awaited, adding latency even though the module is already cached by the bundler after first load
- **No memoization** on any child component or data transformation
- Same pattern of raw state setters passed to children

### Dashboard Limit — Already Fixed

The `.limit(500)` change from the previous audit is already applied to all three report types. No further action needed.

---

## Implementation Plan

### 1. TrainingForm.tsx — Add `useCallback` for `saveTraining` and section updaters

Wrap `saveTraining` in `useCallback` (it already is — line 851). The issue is the child section setters. Since React's `useState` setters are stable references, the real fix is wrapping child components in `React.memo` so they skip re-renders when their props haven't changed.

**Changes:**
- Add `useMemo` import
- Memoize the `saveTraining` function's `updatedTraining` object construction (minor — the bigger win is child memoization)

### 2. DailyAssessmentForm.tsx — Same treatment

**Changes:**
- Add `useMemo` import
- Remove the dynamic `import('@/lib/offline-storage')` inside `handleSaveProgress` — replace with a top-level static import (the module is already imported at lines for other functions). This eliminates the `await import()` overhead on every save.

### 3. Wrap child section components in `React.memo`

**Training children** (5 files):
- `src/components/training/DeliveryApproachSection.tsx`
- `src/components/training/OperatingSystemsSection.tsx`
- `src/components/training/ImmediateAttentionSection.tsx`
- `src/components/training/VerifiableItemsSection.tsx`
- `src/components/training/TrainingSummarySection.tsx`

**Daily Assessment children** (6 files):
- `src/components/daily-assessment/BeginningOfDaySection.tsx`
- `src/components/daily-assessment/EndOfDaySection.tsx`
- `src/components/daily-assessment/OperatingSystemsSection.tsx`
- `src/components/daily-assessment/EquipmentChecksSection.tsx`
- `src/components/daily-assessment/StructureChecksSection.tsx`
- `src/components/daily-assessment/EnvironmentChecksSection.tsx`

For each: wrap the default export in `React.memo()`. Since these components receive stable state setters from `useState`, `React.memo` will correctly skip re-renders when the component's own data hasn't changed.

### 4. DailyAssessmentForm — Static import fix

Replace the dynamic `import('@/lib/offline-storage')` at line 656 with a reference to the already-imported module (the file imports `saveDailyAssessmentOffline`, `saveAssessmentDataOffline`, etc. at the top). This removes a `Promise.race` + timeout wrapper on every save.

---

## Summary

| Change | Files | Impact |
|--------|-------|--------|
| `React.memo` on Training child sections | 5 components | Prevents 4 unnecessary re-renders per keystroke |
| `React.memo` on Daily Assessment child sections | 6 components | Prevents 5 unnecessary re-renders per keystroke |
| Static import in DailyAssessmentForm save | 1 file | Removes async overhead per save |
| Total files changed | **13** | |

No database changes. No new dependencies. All changes are additive `React.memo()` wrappers and a single import refactor.

