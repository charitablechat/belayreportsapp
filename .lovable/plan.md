
# Comprehensive Auth Caching Refactor Plan

## Executive Summary

The audit identified **23 files** containing **~25+ locations** where `supabase.auth.getUser()` is called directly instead of using the optimized `getUserWithCache()` function. This comprehensive refactoring will achieve **100% adoption** of the cached auth utility to maximize performance gains.

---

## Audit Results

### Files Already Using Cached Auth (Compliant)
| File | Status |
|------|--------|
| `src/lib/cached-auth.ts` | Source implementation |
| `src/pages/Dashboard.tsx` | Already refactored |
| `src/hooks/useAutoSync.tsx` | Already refactored |
| `src/hooks/useUnsyncedPhotos.tsx` | Already refactored |
| `src/pages/NewInspection.tsx` | Already refactored |
| `src/pages/NewTraining.tsx` | Already refactored |
| `src/pages/NewDailyAssessment.tsx` | Partially refactored (1 call remains) |
| `src/pages/InspectionForm.tsx` | Partially refactored (1 call remains) |

### Files Requiring Refactoring

#### High-Impact Files (Multiple Calls)

| File | Direct Calls | Priority |
|------|--------------|----------|
| `src/lib/sync-manager.ts` | 10 calls | Critical |
| `src/lib/atomic-sync-manager.ts` | 6 calls | Critical |
| `src/pages/TrainingForm.tsx` | 3 calls | High |
| `src/components/pwa/PushNotificationManager.tsx` | 3 calls | High |
| `src/components/OrganizationAutocomplete.tsx` | 2 calls | Medium |
| `src/components/DatabaseAutocomplete.tsx` | 2 calls | Medium |

#### Single-Call Files

| File | Location | Priority |
|------|----------|----------|
| `src/hooks/useUserProfile.tsx` | Line 19 | High |
| `src/hooks/useRequireSuperAdmin.tsx` | Line 13 | High |
| `src/hooks/useReportEditPermission.tsx` | Line 46 | High |
| `src/hooks/useConflicts.tsx` | Line 33 | Medium |
| `src/hooks/usePushNotifications.tsx` | Lines 118, 162 | Medium |
| `src/pages/Profile.tsx` | Line 50 | Medium |
| `src/pages/DailyAssessmentForm.tsx` | Line 125 | Medium |
| `src/pages/NewDailyAssessment.tsx` | Line 35 | Medium |
| `src/pages/NewInspection.tsx` | Line 41 | Medium |
| `src/pages/InspectionForm.tsx` | Line 764 | Medium |
| `src/components/PhotoCapture.tsx` | Line 37 | Medium |
| `src/components/dashboard/DeveloperNotesCard.tsx` | Line 68 | Low |

#### Special Case: Index.tsx
`src/pages/Index.tsx` uses `supabase.auth.getSession()` for initial authentication verification. This is **intentional** and should NOT be changed - it needs the full session verification on login flow.

---

## Implementation Strategy

### Phase 1: Update Shared Utilities (Critical Path)

**File: `src/lib/sync-manager.ts`**
Replace all 10 occurrences with `getUserWithCache()`:
- Lines 52, 89, 99, 240, 322, 366, 386, 458, 507 - all sync operations
- Import `getUserWithCache` from cached-auth

**File: `src/lib/atomic-sync-manager.ts`**
Replace all 6 occurrences:
- Lines 50, 324, 472, 717, 829, 1066 - all atomic sync operations
- Import `getUserWithCache` from cached-auth

### Phase 2: Update Hooks

**File: `src/hooks/useUserProfile.tsx`**
```typescript
import { getUserWithCache } from '@/lib/cached-auth';
// Line 19: Replace supabase.auth.getUser() with getUserWithCache()
```

**File: `src/hooks/useRequireSuperAdmin.tsx`**
```typescript
import { getUserWithCache } from '@/lib/cached-auth';
// Line 13: Replace supabase.auth.getUser() with getUserWithCache()
```

**File: `src/hooks/useReportEditPermission.tsx`**
```typescript
import { getUserWithCache } from '@/lib/cached-auth';
// Line 46: Replace supabase.auth.getUser() with getUserWithCache()
```

**File: `src/hooks/useConflicts.tsx`**
```typescript
import { getUserWithCache } from '@/lib/cached-auth';
// Line 33: Replace supabase.auth.getUser() with getUserWithCache()
```

**File: `src/hooks/usePushNotifications.tsx`**
```typescript
import { getUserWithCache } from '@/lib/cached-auth';
// Lines 118, 162: Replace supabase.auth.getUser() with getUserWithCache()
```

### Phase 3: Update Page Components

**File: `src/pages/Profile.tsx`**
- Line 50: Replace with `getUserWithCache()`
- Note: The error handling pattern `{ error: userError }` needs adjustment since cached version doesn't return errors the same way

**File: `src/pages/TrainingForm.tsx`**
- Lines 131, 164: Replace with `getUserWithCache()`

**File: `src/pages/DailyAssessmentForm.tsx`**
- Line 125: Replace with `getUserWithCache()`

**File: `src/pages/NewDailyAssessment.tsx`**
- Line 35: Replace with `getUserWithCache()`

**File: `src/pages/NewInspection.tsx`**
- Line 41: Replace with `getUserWithCache()`

**File: `src/pages/InspectionForm.tsx`**
- Line 764: Replace with `getUserWithCache()`

### Phase 4: Update UI Components

**File: `src/components/OrganizationAutocomplete.tsx`**
- Lines 51, 108: Replace with `getUserWithCache()`

**File: `src/components/DatabaseAutocomplete.tsx`**
- Lines 78, 109: Replace with `getUserWithCache()`

**File: `src/components/PhotoCapture.tsx`**
- Line 37: Replace with `getUserWithCache()`

**File: `src/components/pwa/PushNotificationManager.tsx`**
- Lines 31, 67, 91: Replace with `getUserWithCache()`

**File: `src/components/dashboard/DeveloperNotesCard.tsx`**
- Line 68: Replace with `getUserWithCache()`

---

## Code Pattern Changes

### Before (Direct Call)
```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) return;
```

### After (Cached Call)
```typescript
import { getUserWithCache } from '@/lib/cached-auth';

const user = await getUserWithCache();
if (!user) return;
```

### Special Case: Error Handling
For locations like `Profile.tsx` that check for errors:

**Before:**
```typescript
const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
if (userError) throw userError;
```

**After:**
```typescript
const authUser = await getUserWithCache();
if (!authUser) {
  // Handle missing user - cached version handles errors internally
  navigate("/");
  return;
}
```

---

## Files NOT to Modify

| File | Reason |
|------|--------|
| `src/pages/Index.tsx` | Login flow requires full session verification |
| `src/integrations/supabase/client.ts` | Auto-generated, never modify |
| Auth state change listeners | Intentionally use direct Supabase calls |

---

## Safety Considerations

| Concern | Mitigation |
|---------|------------|
| Cache staleness | 60-second TTL ensures freshness |
| Race conditions | Single-flight pattern prevents duplicate requests |
| Offline support | Falls back to localStorage cached session |
| Sign-out handling | Auth listener invalidates cache on SIGNED_OUT event |
| Error handling | Cached version handles errors internally with fallback |

---

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Direct auth API calls | 25+ per session | 1 (cached) |
| Auth network latency | ~100-200ms per call | Eliminated (cache hit) |
| Duplicate concurrent requests | Multiple | Deduplicated |
| Offline auth support | Inconsistent | Consistent fallback |

---

## Testing Checklist

After implementation, verify:

1. Dashboard loads quickly with no visible lag
2. Profile page shows correct user data
3. Super Admin access still works correctly
4. Report editing permissions work for owners
5. Background sync operations complete successfully
6. Push notification preferences load correctly
7. Organization/field autocomplete works
8. Photo capture maintains user context
9. Sign-out properly clears cached state
10. Offline mode still allows viewing cached data

---

## Total Files to Modify

**18 files** requiring changes:
- 2 core utilities (sync-manager, atomic-sync-manager)
- 5 hooks
- 6 pages
- 5 UI components

**Estimated auth API calls eliminated: 24+** per dashboard load sequence
