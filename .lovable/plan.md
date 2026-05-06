# Fix A + B1: Quiet false alarms

## A — Guard "not found" toast/redirect in all three forms

In each form's "no record found" branch, only toast + navigate when the lookup is **conclusive**: server returned a clean null AND IDB layer breaker is closed AND `offlineData` is truly absent.

**Files & locations**
- `src/pages/InspectionForm.tsx` (~1341–1352)
- `src/pages/TrainingForm.tsx` (~515–525)
- `src/pages/DailyAssessmentForm.tsx` (~620–630)

**Logic added before the existing toast/navigate block**
```ts
const serverInconclusive = !!error; // covers Query timeout + any fetch error
const idbInconclusive = getCircuitBreakerStatus().open; // existing helper
if (!data && !offlineData) {
  if (serverInconclusive || idbInconclusive) {
    console.warn('[<Form>] Lookup inconclusive — staying mounted', {
      serverInconclusive, idbInconclusive, id,
    });
    return; // no toast, no redirect; refetch/online recovery will reconcile
  }
  toast.error('… not found', { … });
  navigate('/dashboard');
  return;
}
```

Reuse the same `getCircuitBreakerStatus` import already added in the previous pass (or import it where missing).

## B1 — Demote "Using backup storage" toast

In `src/lib/offline-storage.ts`, at the two emission sites (~line 1847 and ~line 2073):
- Replace the amber `toast(...)` call with `console.warn('[offline-storage] Using backup storage fallback', { context })`.
- Remove the once-per-session sessionStorage flag tied to that specific toast (no longer needed).
- **Keep** the red destructive "Storage unavailable / temporarily unavailable" toasts untouched — those signal real data-loss risk.

The `<NetworkStatusBanner>` and `useStorageHealthCheck` already surface degraded-storage state in the chrome, so the user is not left in the dark.

## Out of scope
Circuit breaker thresholds, IDB timeouts, fallback-to-localStorage path, sync logic, RLS, schema, the global storage-health banner, and the destructive storage toast.

## Verification
1. Force IDB breaker open (DevTools) → open a report → no "not found" toast, form stays mounted.
2. Trigger an IDB write timeout → no amber toast; `console.warn` shows fallback; data still in localStorage; sync recovers on breaker reset.
3. Hard-delete a report server-side (breaker closed, no offline copy) → "not found" toast + redirect still fires correctly.
