

# Fix: "User Not Authenticated" Warning During Offline State

## Problem
When offline (or during network flickers), auth checks can fail and **block local saves entirely** — the user's data is NOT being persisted when this warning appears.

## Root Causes

1. **`ensureValidSession()` fast-path gap**: The recently-added localStorage fast-path doesn't handle expired tokens while offline. `getCachedUserFromStorage()` correctly skips expiry when `!navigator.onLine`, but `ensureValidSession()` does not — it falls through to the slow path which calls `getSession()` and fails.

2. **Network flicker in `performSave()`**: The `getOfflineUserId()` fallback only runs when `!navigator.onLine`. If `navigator.onLine` briefly flickers to `true`, the code skips the offline fallback and calls `ensureValidSession()`, which fails with an expired token.

3. **`sync-manager.ts` has no offline fallback**: Photo sync calls `getUserWithCache()` with no `getOfflineUserId()` guard at all.

## Fix (3 changes)

### File 1: `src/lib/cached-auth.ts` — `ensureValidSession()` (~line 477)
After the two fast-path conditions (lines 460-477), add an offline bypass for expired tokens:
```typescript
// Token expired but user exists AND we're offline — trust it (same as getCachedUserFromStorage)
if (parsed?.user && !navigator.onLine) {
  cachedUser = parsed.user;
  cacheTimestamp = Date.now();
  return parsed.user;
}
```
This ensures `ensureValidSession()` never falls through to `getSession()` when offline.

### File 2: `src/pages/InspectionForm.tsx` — `performSave()` (~line 1359)
Change the online-only `ensureValidSession` fallback to also try `getOfflineUserId()` before throwing:
```typescript
if (!user && navigator.onLine) {
  user = await ensureValidSession();
}
// Last resort: network may have flickered — try offline ID
if (!user) {
  const offlineId = getOfflineUserId();
  if (offlineId) user = { id: offlineId } as any;
}
```
Apply the same pattern to `TrainingForm.tsx` and `DailyAssessmentForm.tsx` in their equivalent `performSave()` functions.

### File 3: `src/lib/sync-manager.ts` (~line 129-130)
Add offline fallback to photo sync:
```typescript
let user = await getUserWithCache();
if (!user) {
  const { getOfflineUserId } = await import('./cached-auth');
  const offlineId = getOfflineUserId();
  if (offlineId) user = { id: offlineId } as any;
}
if (!user) throw new Error("Not authenticated");
```

## Files Changed
1. `src/lib/cached-auth.ts` — offline bypass in `ensureValidSession()` fast-path
2. `src/pages/InspectionForm.tsx` — final `getOfflineUserId()` guard in `performSave()`
3. `src/pages/TrainingForm.tsx` — same guard
4. `src/pages/DailyAssessmentForm.tsx` — same guard
5. `src/lib/sync-manager.ts` — offline fallback for photo uploads

## Result
- Offline saves will **always succeed** — no more "User not authenticated" blocking local persistence
- Network flickers won't cause auth failures
- Photo sync gracefully degrades when offline
- No impact on online behavior — all changes are guarded by `!navigator.onLine` or null-user checks

