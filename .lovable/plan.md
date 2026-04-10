

# Comprehensive Application Bug Audit & Fix Plan

## Audit Findings

### BUG 1: Unused imports in App.tsx (LOW — dead code / bundle size)

**File:** `src/App.tsx` lines 35-36

`NetworkStatusIndicator` and `SyncStatusIndicator` are imported but never used in the JSX template. These are dead imports that add unnecessary bytes to the bundle.

**Fix:** Remove the two unused import lines.

---

### BUG 2: Stale closure in ItemPhotoUpload cleanup effect (MEDIUM — memory leak)

**File:** `src/components/inspection/ItemPhotoUpload.tsx` lines 90-95

The cleanup `useEffect` has an empty dependency array `[]` but captures `localPreview` from the initial render (always `null`). When `localPreview` changes later, the cleanup function still references the stale initial value and never revokes the real object URL.

**Fix:** Use a ref to track `localPreview` so the cleanup always revokes the latest URL:
```typescript
const localPreviewRef = useRef<string | null>(null);
useEffect(() => { localPreviewRef.current = localPreview; }, [localPreview]);

useEffect(() => {
  return () => {
    if (prevObjectUrlRef.current) URL.revokeObjectURL(prevObjectUrlRef.current);
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
  };
}, []);
```

---

### BUG 3: Multiple `onAuthStateChange` listeners accumulate (MEDIUM — performance)

**File:** `src/lib/cached-auth.ts` line 42

The `initAuthListener()` function in `cached-auth.ts` registers an `onAuthStateChange` callback that is **never unsubscribed**. It uses a boolean gate (`authListenerInitialized`) so it only fires once, which is correct — but this is in addition to per-component listeners registered in:
- `AuthenticatedHeader.tsx` (properly cleaned up)
- `Dashboard.tsx` (properly cleaned up)
- `InspectionForm.tsx` (properly cleaned up)
- `useReportEditPermission.tsx` (properly cleaned up)

With 5 total listeners, every auth event (token refresh every ~60 mins, tab focus, etc.) fires 5 handlers. This is acceptable but worth noting. The cached-auth one cannot be unsubscribed by design (singleton pattern). **No fix needed** — this is by design.

---

### BUG 4: `handleOnline` triggers non-silent sync bypassing debounce (LOW-MEDIUM)

**File:** `src/hooks/useAutoSync.tsx` line 533

When the device goes online, `performSync(false)` is called (non-silent), which bypasses the `MIN_SYNC_INTERVAL` debounce. If the network flickers repeatedly (common on mobile), this can trigger rapid consecutive sync attempts. The `syncInProgressRef` guard prevents true duplicates, but the waiting promise (lines 174-186) queues up, potentially stacking multiple 15-second timeout promises.

**Fix:** Add a debounce to `handleOnline` — use `triggerDebouncedSync()` instead of `performSync(false)`, or add a minimum gap check before the session refresh + sync.

---

### BUG 5: `refreshSession` result type mismatch in `handleOnline` (LOW)

**File:** `src/hooks/useAutoSync.tsx` lines 509-514

The `Promise.race` resolves with either `supabase.auth.refreshSession()` (which returns `{ data, error }`) or a timeout that returns `{ error: { message } }`. The check `if ('error' in refreshResult && refreshResult.error)` will be true for both the timeout AND a successful result where `error` is `null`. The code works because it only logs a warning, but the type handling is imprecise.

**Fix:** Check `refreshResult.error` more explicitly — the current behavior is safe but could log spurious warnings if `refreshSession` succeeds with `error: null`.

---

### BUG 6: `useReportTabHistory` popstate handler doesn't check `isOverlayActive` (MEDIUM)

**File:** `src/hooks/useReportTabHistory.tsx` lines 73-96

When a lightbox is open inside a report form (overlay active), the tab history popstate handler can still fire and process the back-button press as a tab navigation. The App.tsx handler checks `isOverlayActive()` and `isReportTabActive()` to bail, but the tab history handler itself doesn't check `isOverlayActive()`. Both handlers run because `addEventListener` fires all registered listeners.

**Scenario:** Open lightbox inside report → press back → lightbox handler closes lightbox AND tab handler also pops a tab from history, causing an unexpected tab change.

**Fix:** Add `if (isOverlayActive()) return;` at the top of the `handlePopState` in `useReportTabHistory.tsx`.

---

### BUG 7: PhotoGallery lightbox pushes duplicate history entries on rapid open/close (LOW)

**File:** `src/components/PhotoGallery.tsx` lines 122-143

When a user rapidly opens photo A, closes it (via X button which calls `window.history.back()`), then immediately opens photo B, the effect cleanup for A may not have run yet. The new effect for B pushes another `{ lightbox: true }` entry. This leaves an orphaned history entry in the stack.

**Fix:** Guard the `pushState` with a check: only push if `lightboxHistoryPushedRef.current` is false. Currently the ref is reset to false when the lightbox closes, but there's a race window.

---

### BUG 8: `camera-capture-dialog.tsx` doesn't revoke preview URL on dialog close (LOW — memory leak)

**File:** `src/components/ui/camera-capture-dialog.tsx` line 99

When the dialog closes without the user clicking "Retake" or "Use Photo", the `previewUrl` object URL created at line 99 is never revoked. The `handleRetake` function properly revokes it, but closing the dialog via the X button or overlay click doesn't.

**Fix:** Add a cleanup effect that revokes `previewUrl` when the dialog's `open` prop changes to `false`.

---

## Fix Plan Summary

| # | Severity | File | Fix |
|---|----------|------|-----|
| 1 | LOW | `App.tsx` | Remove unused `NetworkStatusIndicator` and `SyncStatusIndicator` imports |
| 2 | MEDIUM | `ItemPhotoUpload.tsx` | Use ref for `localPreview` in cleanup effect |
| 3 | — | `cached-auth.ts` | No fix needed (by design) |
| 4 | LOW-MED | `useAutoSync.tsx` | Debounce `handleOnline` with min interval check |
| 5 | LOW | `useAutoSync.tsx` | Tighten `refreshResult.error` check |
| 6 | MEDIUM | `useReportTabHistory.tsx` | Add `isOverlayActive()` guard to popstate handler |
| 7 | LOW | `PhotoGallery.tsx` | Guard duplicate `pushState` with ref check |
| 8 | LOW | `camera-capture-dialog.tsx` | Revoke preview URL on dialog close |

## Files Changed
1. `src/App.tsx` — remove 2 unused imports
2. `src/components/inspection/ItemPhotoUpload.tsx` — ref-based cleanup for localPreview
3. `src/hooks/useAutoSync.tsx` — debounce handleOnline, tighten error check
4. `src/hooks/useReportTabHistory.tsx` — add overlay guard to popstate handler
5. `src/components/PhotoGallery.tsx` — guard duplicate lightbox history push
6. `src/components/ui/camera-capture-dialog.tsx` — revoke preview URL on close

