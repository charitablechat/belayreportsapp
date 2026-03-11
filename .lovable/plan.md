

## Investigation: Missing Hard-Save Toast = Data Not Actually Saved

### Root Cause Identified

The hard-save toast and the actual IndexedDB persistence are **decoupled** in a way that creates a silent failure mode. Here is the exact flow:

```text
saveProgress() → performSave(silent=false)
  ├─ Line 1439: await Promise.all(childSaveOps)     ← ACTUAL SAVE (IndexedDB)
  ├─ Line 1440: localSaveSucceeded = true
  └─ Line 1444-1452: appendVersion(...).then(v => {  ← TOAST TRIGGER (fire-and-forget)
       if (v) showHardSavedToast(...)                ← Only fires if v is not null
     }).catch(() => {})                              ← Errors silently swallowed
```

**Three failure scenarios cause missing toast + missing data:**

### Scenario 1: IndexedDB Timeout (Most Likely — Visible in Console Logs)

The console shows repeated `[Offline Storage] Operation timed out after 5000ms` warnings. When IndexedDB is slow/hung:

- `Promise.all(childSaveOps)` at line 1439 **throws** (timeout)
- Execution jumps to the `catch` block at line 1453
- `localSaveSucceeded` stays `false`
- `appendVersion` at line 1444 **never executes** → no toast
- The outer catch at line 1453 only does `console.warn` — it does **not** re-throw or show a user-facing error
- Execution continues to the online sync section, which may also fail
- **Result**: No toast, no local save, user thinks nothing happened

### Scenario 2: Circuit Breaker Open

When IndexedDB has 3+ consecutive timeouts, the circuit breaker opens. All subsequent `saveRelatedDataOffline` and `appendVersion` calls fail instantly (0ms). Same outcome: no toast, no save.

### Scenario 3: `appendVersion` Returns Null

Even if the main save succeeds, `appendVersion` returns `null` when:
- `report_versions` store doesn't exist (pre-v8 IndexedDB schema)
- Any internal error (caught at line 140-143)

In this case data IS saved but the toast doesn't fire, which is confusing but not data-losing.

### The Core Bug

**When the offline save fails (Scenarios 1 & 2), the user receives NO feedback whatsoever.** The `catch` block at line 1453 only logs a `console.warn` — there is no toast, no error state set, no UI indication. The `saving` spinner just stops.

### Proposed Fix

**1. Show error toast when local save fails** (line 1453 catch block):
```ts
catch (offlineError) {
  console.warn('[InspectionForm Save] Offline storage failed:', offlineError);
  // NEW: Alert user that save failed
  if (!silent) {
    toast.error("Save failed", {
      description: "Local storage is unavailable. Please try again.",
      duration: 5000,
    });
  }
  setSaveError('Local save failed — please retry');
}
```

**2. Move toast trigger out of `appendVersion` chain** — show it when `localSaveSucceeded` is true, regardless of version history:
```ts
// After line 1440 (localSaveSucceeded = true):
if (!silent) {
  // Show hard-saved toast immediately on successful local save
  // Version number will update async via appendVersion
  showHardSavedToast(lastVersionNumber ? lastVersionNumber + 1 : undefined, undefined);
}

// Keep appendVersion fire-and-forget for version metadata only
appendVersion(...).then(v => {
  if (v) {
    setLastVersionNumber(v.versionNumber);
    setLastFieldCount(v.fieldCount);
  }
}).catch(() => {});
```

**3. Apply same pattern to TrainingForm and DailyAssessmentForm** — verify they have the identical decoupled toast/save issue.

### Summary

| Scenario | Data Saved? | Toast Shown? | User Knows? |
|----------|------------|-------------|-------------|
| IndexedDB timeout | No | No | No ← **BUG** |
| Circuit breaker open | No | No | No ← **BUG** |
| appendVersion fails but save succeeds | Yes | No | No ← **Confusing** |
| Everything works | Yes | Yes | Yes |

The fix ensures: failed saves always show an error toast, and successful saves always show the hard-saved toast — independent of the version history subsystem.

