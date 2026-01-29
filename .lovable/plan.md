
# Plan: Optimize Dashboard Loading Performance

## Root Cause Analysis

I've identified **five major performance bottlenecks** causing the loading lag:

### Bottleneck 1: Excessive Duplicate Auth Calls (PRIMARY ISSUE)
**Evidence from Network Logs**: 7+ sequential calls to `supabase.auth.getUser()` within a 4-second window during Dashboard load.

**Root Cause**: Multiple components and hooks independently call `supabase.auth.getUser()` without caching:

| Location | Trigger |
|----------|---------|
| `Dashboard.tsx` line 126 | `is-super-admin` query |
| `Dashboard.tsx` lines 215, 263, 310 | Each of `loadInspections`, `loadTrainingReports`, `loadDailyAssessments` |
| `useAutoSync.tsx` line 125 | `updateUnsyncedCounts()` |
| `useUnsyncedPhotos.tsx` line 19 | `updatePhotoCount()` |
| `PWAProvider.tsx` | Aggregates all these hooks |

Each network auth call adds ~100-200ms latency. 7 calls = **700-1400ms wasted**.

### Bottleneck 2: Sequential Offline Storage Saves
**Location**: Dashboard.tsx lines 246-248, 293-295, 340-342

After fetching from Supabase, reports are saved to IndexedDB **one-by-one** in a blocking `for` loop:

```typescript
for (const inspection of data) {
  await saveInspectionOffline(inspection);  // Blocking!
}
```

With 6 inspections, 9 trainings, and 7 assessments (22 items), this adds significant latency.

### Bottleneck 3: Blocking Initial Sync in PWAProvider
**Location**: `useAutoSync.tsx` lines 214-217

The `useAutoSync` hook triggers `performSync(true)` on mount, which:
1. Calls `supabase.auth.getUser()` again
2. Calls `updateUnsyncedCounts()` (another `getUser()` call)
3. Executes 4 parallel sync operations

This sync happens **before** the Dashboard even starts loading its data.

### Bottleneck 4: Redundant Data Loading Functions
**Location**: Dashboard.tsx lines 212-352

Each of `loadInspections`, `loadTrainingReports`, and `loadDailyAssessments` independently:
1. Calls `getUserWithCache()` (which may hit auth API)
2. Queries IndexedDB
3. Queries Supabase

While they run in parallel via `Promise.all()`, the auth calls are still sequential internally.

### Bottleneck 5: React Warning Noise (Minor)
**Console Log**: `Warning: Function components cannot be given refs`

The `Badge` component is being used inside a Radix `Tooltip` without `forwardRef`. This creates unnecessary console warnings that slow dev tools but don't directly impact production.

---

## Proposed Solution

### Fix 1: Implement User Caching with Session-Level Memoization

Create a cached auth utility that stores the user for the session lifecycle:

**New File**: `src/lib/auth-cache.ts`

```typescript
let cachedUser: User | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000; // 1 minute cache

export async function getCachedAuthUser(): Promise<User | null> {
  const now = Date.now();
  
  // Return cached user if still valid
  if (cachedUser && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedUser;
  }
  
  // Fetch fresh user and cache
  const { data: { user } } = await supabase.auth.getUser();
  cachedUser = user;
  cacheTimestamp = now;
  
  return user;
}

export function invalidateUserCache() {
  cachedUser = null;
  cacheTimestamp = 0;
}
```

### Fix 2: Batch Offline Storage Writes

Replace sequential saves with parallel batch operations:

**Before**:
```typescript
for (const inspection of data) {
  await saveInspectionOffline(inspection);
}
```

**After**:
```typescript
await Promise.all(data.map(inspection => 
  saveInspectionOffline(inspection)
));
```

### Fix 3: Defer Initial Sync Until After UI Render

Modify `useAutoSync` to delay initial sync:

```typescript
useEffect(() => {
  // Delay initial sync to not block UI render
  const syncTimer = setTimeout(() => {
    if (navigator.onLine) {
      performSync(true);
    }
  }, 2000); // 2 second delay
  
  return () => clearTimeout(syncTimer);
}, []);
```

### Fix 4: Hoist User Fetch to Dashboard Level

Fetch user once at Dashboard mount, then pass to data loading functions:

```typescript
const loadAllData = async () => {
  setLoading(true);
  
  // Fetch user ONCE
  const user = await getCachedAuthUser();
  const userId = user?.id;
  
  // Pass userId to all loaders (no internal auth calls needed)
  await Promise.all([
    loadInspections(userId),
    loadTrainingReports(userId),
    loadDailyAssessments(userId)
  ]);
  
  setLoading(false);
};
```

### Fix 5: Fix Badge forwardRef Warning

Add `forwardRef` to the Badge component for proper Radix integration.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/auth-cache.ts` | New file - centralized user caching |
| `src/pages/Dashboard.tsx` | Use cached auth, batch IndexedDB writes, pass userId to loaders |
| `src/hooks/useAutoSync.tsx` | Defer initial sync, use cached auth |
| `src/hooks/useUnsyncedPhotos.tsx` | Use cached auth |
| `src/lib/atomic-sync-manager.ts` | Use cached auth |
| `src/components/ui/badge.tsx` | Add forwardRef |

---

## Expected Performance Improvement

| Metric | Before | After |
|--------|--------|-------|
| Auth API calls on load | 7+ | 1 (cached) |
| IndexedDB saves pattern | Sequential | Parallel |
| Initial sync timing | Blocking | Deferred |
| Estimated load time | 3-5 seconds | <1 second |

---

## Technical Details

### Auth Cache Implementation

The cache uses a simple timestamp-based TTL pattern:
- User is cached for 60 seconds after first fetch
- Cache invalidates on sign-out via `onAuthStateChange` listener
- All hooks/components share the same cache instance

### Batch Write Strategy

IndexedDB supports concurrent writes. By using `Promise.all()`:
- 22 sequential writes (~50ms each) = 1100ms
- 22 parallel writes = ~100-150ms total

### Deferred Sync Justification

Initial sync is non-critical for UI render because:
- Offline data shows immediately from IndexedDB
- Fresh data loads from Supabase queries
- Background sync is for reconciliation, not display

---

## Safety Considerations

| Concern | Mitigation |
|---------|------------|
| Stale user data | 60-second TTL + invalidation on auth events |
| Race conditions | Cache uses single promise pattern |
| Offline behavior | Falls back to localStorage cached session |
| Security | No bypass of RLS or auth checks |
