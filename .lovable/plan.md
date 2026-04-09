

# Remaining "User Not Authenticated" Gaps

## Summary of Findings

The recent fixes hardened the three form **save** paths (InspectionForm, TrainingForm, DailyAssessmentForm) and the sync-manager. However, **5 code locations** still throw "Not authenticated" without an offline fallback, and some can surface as user-visible errors.

## Gaps Found

### Gap 1: `NewInspection.tsx` — creating a new report (line 448-457)
Calls `getUserWithCache()` with no `getOfflineUserId()` fallback. If the cache returns null during a network flicker while online, it throws `"Not authenticated"`. When offline, it shows `"Please sign in to create reports"` even though the user IS signed in — it just can't retrieve their identity.
**Impact**: User cannot create new inspections offline or during flickers.

### Gap 2: `NewTraining.tsx` — creating a new training (line 118-127)
Same pattern: no `getOfflineUserId()` fallback. Offline → shows misleading "Please sign in" toast. Flicker → navigates to home page.
**Impact**: User cannot create new trainings offline.

### Gap 3: `NewDailyAssessment.tsx` — creating a new assessment (line 128-137)
Identical gap.
**Impact**: User cannot create new daily assessments offline.

### Gap 4: `DatabaseAutocomplete.tsx` — saving field history (line 110-111)
Throws `"Not authenticated"` with no fallback. This is a mutation inside a form, so it could surface as a toast error while the user is typing/selecting values offline.
**Impact**: Low severity — field history is a convenience feature and the error is silent (mutation error), but it could confuse users if they see a toast.

### Gap 5: `Onboarding.tsx` — toggling resource completion (line 72-73)
Uses raw `supabase.auth.getUser()` (not even `getUserWithCache`), which makes a network call. Will fail offline.
**Impact**: Low — onboarding is a one-time flow typically done online.

### Non-gaps (confirmed safe)
- `usePushNotifications.tsx` — push subscription requires network by definition, so throwing is correct
- `useConflicts.tsx` — query is gated by `enabled: navigator.onLine`, so it never runs offline
- `atomic-sync-manager.ts` — only runs when online; console.warn only, no user-visible error
- All three form save paths — already patched with `getOfflineUserId()` fallback

## Fix Plan

### Files 1-3: `NewInspection.tsx`, `NewTraining.tsx`, `NewDailyAssessment.tsx`
Add `getOfflineUserId()` fallback after `getUserWithCache()` returns null — same pattern already used in the form save paths:
```typescript
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";

const user = await getUserWithCache();
if (!user) {
  const offlineId = getOfflineUserId();
  if (offlineId) {
    // Proceed with offline ID
    user = { id: offlineId } as any;
  } else {
    // Truly not authenticated
    toast.error("Please sign in to create reports");
    return;
  }
}
```
This removes the misleading "Please sign in" message when the user IS authenticated but offline.

### File 4: `DatabaseAutocomplete.tsx`
Add a silent bail-out instead of throwing when offline — field history is non-critical:
```typescript
const user = await getUserWithCache();
if (!user) {
  // Skip saving history when auth unavailable (offline)
  return;
}
```

### File 5: `Onboarding.tsx` (low priority)
Replace `supabase.auth.getUser()` with `getUserWithCache()` for consistency, though this page is rarely used offline.

## Files Changed
1. `src/pages/NewInspection.tsx` — add `getOfflineUserId()` fallback
2. `src/pages/NewTraining.tsx` — add `getOfflineUserId()` fallback
3. `src/pages/NewDailyAssessment.tsx` — add `getOfflineUserId()` fallback
4. `src/components/DatabaseAutocomplete.tsx` — silent bail-out when no user
5. `src/pages/Onboarding.tsx` — switch to `getUserWithCache()` (minor)

