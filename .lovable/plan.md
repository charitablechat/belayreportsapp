
# Stale Data Bug Audit -- Findings and Fixes

## Bug 1: Stale `state.unsyncedCount` in `performSync` (useAutoSync.tsx, line 156)

**File:** `src/hooks/useAutoSync.tsx`
**Line:** 156
**Severity:** Low (functional impact is limited to timeout calculation)

**Mechanism:** `performSync` is created via `useCallback` with a dependency array that does NOT include `state.unsyncedCount` (line 285: `[queryClient, isMobileDevice, isIOSDevice]`). The `state.unsyncedCount` read on line 156 captures the value from the render when the callback was last created, not the current value. This means the dynamic timeout calculation (`batchSize = Math.min(state.unsyncedCount, MAX_BATCH_SIZE)`) may use a stale count.

**Impact:** The timeout could be too short (defaulting to `BASE_SYNC_TIMEOUT` of 30s when unsyncedCount is stale at 0) or too long. In practice, the `MAX_BATCH_SIZE` cap of 5 limits the range to 30-70 seconds, and the safety timeout at `dynamicTimeout + 2000` provides a backstop, so this is unlikely to cause visible issues but is technically a stale closure.

**Fix:** Use a ref to track unsyncedCount, or read `state.unsyncedCount` via functional state access. The simplest fix: add `state.unsyncedCount` to the dependency array, or (better) replace the read with a synchronous IndexedDB count fetched at sync time.

---

## Bug 2: `currentUser` auth listener in InspectionForm clears user when offline (line 347)

**File:** `src/pages/InspectionForm.tsx`
**Line:** 345-348
**Severity:** Medium

**Mechanism:** The `onAuthStateChange` callback unconditionally sets `currentUser` to `session?.user ?? null`. When offline, Supabase may emit auth events with a null session (e.g., due to token refresh failure), which clears `currentUser` to `null`. This is the same class of bug that was fixed in `useReportEditPermission` but was NOT applied to the InspectionForm's own `currentUser` state.

While `currentUser` is not directly used for the read-only gating (that's handled by `useReportEditPermission`), it IS used on line 1093-1094 to determine `last_modified_by` during saves. A null `currentUser` while offline means `last_modified_by` is never set, causing stale/missing audit trail data.

**Fix:** Apply the same offline guard pattern:
```
const { data: { subscription } } = supabase.auth.onAuthStateChange(
  (_event, session) => {
    if (session?.user) {
      setCurrentUser(session.user);
    } else if (navigator.onLine) {
      setCurrentUser(null);
    }
  }
);
```

---

## Bug 3: Auto-save `useEffect` dependency captures stale `isOwner` (line 448)

**File:** `src/pages/InspectionForm.tsx`
**Line:** 448, dependency array line 461
**Severity:** Low

**Mechanism:** The auto-save effect on line 447-461 references `isOwner` in the callback body but does NOT include it in the dependency array (`[systems, ziplines, equipment, standards, summary]`). If `isOwner` transitions from `false` to `true` (e.g., after async permission check completes), the effect still uses the stale `false` value from the initial render, potentially skipping valid auto-saves for a brief window until another tracked dependency changes.

**Impact:** Minimal in practice because `isOwner` resolves quickly and other dependencies (data arrays) change frequently. However, in an edge case where permission resolves after the initial data load, the first edit could fail to trigger auto-save.

**Fix:** Add `isOwner` to the dependency array on line 461:
```
}, [systems, ziplines, equipment, standards, summary, isOwner]);
```

---

## Bug 4: Summary auto-regeneration effect missing `isOwner` dependency (line 624)

**File:** `src/pages/InspectionForm.tsx`
**Line:** 548, dependency array line 624
**Severity:** Low

**Mechanism:** The real-time summary regeneration effect (line 546-624) checks `isOwner` on line 548 as a guard, but the dependency array on line 624 is `[equipment, systems, ziplines, loading, inspection?.id]`. If `isOwner` changes from `false` to `true` after mount, the effect uses the stale `false` value and skips regeneration until one of the tracked dependencies changes.

**Fix:** Add `isOwner` to the dependency array on line 624:
```
}, [equipment, systems, ziplines, loading, inspection?.id, isOwner]);
```

---

## Bug 5: `loadInspection` captures stale `isOwner` for server fetch guard (line 869)

**File:** `src/pages/InspectionForm.tsx`
**Line:** 869
**Severity:** Medium

**Mechanism:** The `loadInspection` function (defined inside the component) reads `isOwner` on line 869: `if (isOnline && !id!.startsWith('temp-') && isOwner)`. However, `loadInspection` is called from the `useEffect` on line 330 which runs on mount when `isOwner` is still `false` (permission check is async). This means the server data fetch is skipped on initial load for legitimate owners, and the form displays only IndexedDB data.

This is partially mitigated because IndexedDB data is loaded first anyway, but it means:
- Fresh server data (e.g., changes made from another device) is not fetched on first load
- The `last_opened_at` timestamp is not updated
- The `isLocalDataNewer` comparison never runs

**Fix:** Remove the `isOwner` guard from the server fetch path, or restructure `loadInspection` to be called after permissions resolve. The `isOwner` check was likely added to prevent non-owners from triggering writes, but the `last_opened_at` update could be moved behind a separate owner check, while the data READ should always happen.

---

## Summary of Recommended Changes

| File | Line | Bug | Severity | Fix |
|------|------|-----|----------|-----|
| `src/hooks/useAutoSync.tsx` | 156/285 | Stale `unsyncedCount` in timeout calc | Low | Add to deps or use ref |
| `src/pages/InspectionForm.tsx` | 347 | Auth listener clears user offline | Medium | Add `navigator.onLine` guard |
| `src/pages/InspectionForm.tsx` | 448/461 | Missing `isOwner` in auto-save deps | Low | Add `isOwner` to deps |
| `src/pages/InspectionForm.tsx` | 548/624 | Missing `isOwner` in summary regen deps | Low | Add `isOwner` to deps |
| `src/pages/InspectionForm.tsx` | 869 | Server fetch skipped due to stale `isOwner` | Medium | Decouple read from owner check |

The two medium-severity bugs (2 and 5) should be prioritized. Bug 2 is a quick one-line fix. Bug 5 requires separating the "read data" path from the "update last_opened_at" path.
