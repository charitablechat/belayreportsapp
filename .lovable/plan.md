

## Audit: Training & Daily Assessment vs. Inspection Form Auto-Save Integrity

### Comparison Matrix

| Integrity Check | InspectionForm | TrainingForm | DailyAssessmentForm |
|---|---|---|---|
| **Dual mutex (`anySaveInProgressRef`)** | Yes — prevents concurrent auto/manual/emergency saves | **No** — single `saveInProgressRef` only | **No** — single `saveInProgressRef` only |
| **`triggerImmediateSave` (instant flush)** | Yes — used by child tables on blur/selection | **No** — relies on 1.5s debounce only | **No** — relies on 1.5s debounce only |
| **`summaryRef` (anti-stale-closure)** | Yes — `useRef` + sync `useEffect` for summary | **No** — reads `summary` from closure | **No** — reads state from closure |
| **Auto-save state guard (`autoSaving`)** | Yes — separate `autoSaving` state prevents re-entry | **No** — reuses `isSaving` for both | **No** — reuses `saving` for both |
| **Safety timeout resets ALL mutex refs** | Yes — resets both `saveInProgressRef` + `anySaveInProgressRef` | Partial — only resets `saveInProgressRef` | Partial — only resets `saveInProgressRef` |
| **30s backup interval** | Yes (30s) | Yes (30s) | **10s** — more aggressive, higher collision risk |
| **Auth check before save** | Yes — `getUserWithCache()` with offline fallback | **No** — no auth verification | **No** — no auth verification |
| **`isInternalUpdateRef` skip in auto-save** | Yes | Yes | Yes |

---

### Gap 1: No Dual Mutex — Concurrent Save Risk (Both Forms)

**Problem:** InspectionForm has `anySaveInProgressRef` as a global mutex across `performSave`, `triggerImmediateSave`, `autoSaveProgress`, and `saveProgress`. Training and DailyAssessment only have `saveInProgressRef`, which is checked at the top of their single save function. However, the auto-save `useEffect` debounce and the 30s/10s interval both call `saveTraining(true)` / `handleSaveProgress(true)` without checking any external lock — if one is already running, it relies solely on `saveInProgressRef` at the function entry.

**Risk:** If a manual save is in progress when the debounce or interval fires, `saveInProgressRef` correctly blocks the second call. This is **adequate** for the single-function pattern. However, the emergency save (`useEmergencySave`) calls `performSaveRef.current?.(true)` which is the same function — so it's also guarded. **Verdict: Low risk — the single-mutex is sufficient because there's only one save function.**

**Fix needed:** None — the single mutex covers all entry points because Training/DailyAssessment don't have separate `performSave`/`saveProgress`/`autoSaveProgress`/`triggerImmediateSave` code paths like Inspection does.

---

### Gap 2: No `triggerImmediateSave` — Stale Data on Single-Click Actions (Both Forms)

**Problem:** InspectionForm provides `onImmediateSave` to child tables (EquipmentTable, ZiplinesTable, etc.) which flushes the debounce timer and saves immediately on blur/selection events. Training and DailyAssessment child components (`DeliveryApproachSection`, `BeginningOfDaySection`, etc.) only call `setXxx()` to update state, relying on the 1.5s debounce.

**Risk:** If a user changes a dropdown/selection and immediately closes the tab or navigates away within 1.5s, the debounce hasn't fired. The `useEmergencySave` hook covers this case by triggering on `visibilitychange`/`pagehide`. **Verdict: Medium risk — emergency save covers tab close, but a navigation via router within the app could miss it if the `beforeunload` blocker doesn't fire (SPA routing).**

**Fix:** Add `triggerImmediateSave` equivalent to both forms for critical single-click fields (date pickers, result selects, rich-text blur). This is an enhancement, not a bug — emergency save provides the safety net.

---

### Gap 3: No `summaryRef` — Stale Closure in Save (Both Forms)

**Problem:** InspectionForm uses `summaryRef` (a `useRef` synced with `useEffect`) so that `performSave` always reads the latest summary even if React state hasn't committed yet. Training and DailyAssessment read `summary`/`operatingSystems`/etc. directly from the closure captured by `useCallback` or inline `async` functions.

**Risk:** In TrainingForm, `saveTraining` is wrapped in `useCallback` with the correct dependencies (`[training, id, deliveryApproaches, operatingSystems, ...]`). When a dependency changes, React creates a new closure with fresh values. The debounce timer calls `saveTraining(true)` — but this reference comes from the `useEffect` that watches the same dependencies, which re-runs and creates a new timer with the new `saveTraining`. So the closure is usually fresh. **However**, there's a 1-render window where the debounce timer holds a stale `saveTraining` reference (the timer was set with the old closure, but the state has updated). The 1.5s debounce makes this window negligible in practice.

**Verdict: Low risk for normal typing. Medium risk for rapid programmatic state updates (e.g., auto-populate).** The `isInternalUpdateRef` skip prevents auto-save during programmatic updates, which mitigates this.

**Fix:** Not critical, but for parity: convert `saveTraining` and `handleSaveProgress` from `useCallback` to a ref-based pattern (declare as plain `async function`, assign to ref on every render, call via ref). This eliminates stale closures entirely.

---

### Gap 4: DailyAssessment 10s Backup Interval vs 30s Standard

**Problem:** DailyAssessment uses a 10-second backup interval (line 399) vs the 30-second standard in Inspection and Training. This triples the save frequency, increasing IndexedDB transaction pressure on slow devices.

**Fix:** Change to 30s to match the other forms.

---

### Gap 5: No Auth Check Before Save (Both Forms)

**Problem:** InspectionForm calls `getUserWithCache()` at the top of `performSave` and falls back to `getOfflineUserId()` if offline. Training and DailyAssessment skip this check entirely — they save to IndexedDB regardless of auth state, and attempt server sync with whatever session exists.

**Risk:** If the session has expired, IndexedDB saves still work (good), but server sync will fail with a 401 (handled by the catch block). The lack of auth check is not a data-loss vector — it's a missed optimization (could skip server sync early). **Verdict: Low risk.**

**Fix:** Not critical. The existing error handling covers expired sessions.

---

### Gap 6: DailyAssessment Parent Save Is Outside the `localSaveSucceeded` Guard

**Problem:** In DailyAssessmentForm, `saveDailyAssessmentOffline(updatedAssessment)` at line 775 runs **after** the `localSaveSucceeded` flag is set from the child ops at line 735. But the parent assessment object is constructed at line 764 — **after** the child save block. The parent save runs outside the try/catch that sets `localSaveSucceeded`, meaning:
- Child data saves → `localSaveSucceeded = true`
- Parent save fails (line 775-778 has its own try/catch that only warns)
- Server sync proceeds because `localSaveSucceeded` is `true`
- Server has parent data that local IndexedDB doesn't

**Fix:** Move parent save into the `childOps` array, or check its success before allowing server sync.

---

### Summary of Required Fixes

| Priority | Gap | Forms | Fix |
|---|---|---|---|
| **High** | Gap 6: Parent save outside `localSaveSucceeded` guard | DailyAssessment | Move parent save into `childOps` or add success tracking |
| **Medium** | Gap 2: No `triggerImmediateSave` for single-click fields | Both | Add immediate save on critical field blur/change |
| **Low** | Gap 4: 10s interval instead of 30s | DailyAssessment | Change to 30s |
| **Low** | Gap 3: Stale closure risk | Both | Convert to ref-based save pattern |
| **None** | Gap 1: Single mutex | Both | Already sufficient |
| **None** | Gap 5: No auth check | Both | Covered by error handling |

### Implementation Plan

**File: `src/pages/DailyAssessmentForm.tsx`**
1. Move `saveDailyAssessmentOffline(updatedAssessment)` into the `childOps` array so it's included in the `await Promise.all(childOps)` that sets `localSaveSucceeded`
2. Change backup interval from 10s to 30s

**File: `src/pages/TrainingForm.tsx`**
- No critical fixes needed. The existing pattern is sound for its architecture.

Optional enhancements (both forms) deferred to a follow-up:
- Add `triggerImmediateSave` for date pickers and result selects
- Convert save functions to ref-based pattern for stale-closure elimination

