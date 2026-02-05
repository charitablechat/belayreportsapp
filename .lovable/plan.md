

# Super Admin Access & Performance Resolution Plan (v2.3.6)

## Executive Summary

After comprehensive analysis of the codebase, database schema, RLS policies, and data access patterns, I've identified **three distinct issues** affecting Super Admin report visibility and performance:

| Issue | Severity | Root Cause | Status |
|-------|----------|------------|--------|
| **Offline Storage User Filtering** | HIGH | Super Admins get filtered to own reports in offline fallback | **Needs Fix** |
| **Missing Performance Indexes** | MEDIUM | No index on `user_roles(user_id, role)` for fast super admin lookup | **Needs Fix** |
| **Super Admin Status Caching** | MEDIUM | Multiple redundant RPC calls per session | **Optimization Needed** |

---

## Issue 1: Offline Storage User Filtering

### Problem
When the Dashboard loads, it shows offline data immediately while network data loads. The offline storage functions filter by `inspector_id === userId`:

```typescript
// src/lib/offline-storage.ts - Line 556-558
if (userId) {
  return allInspections.filter(i => i.inspector_id === userId);
}
```

For Super Admins, this means:
1. User logs in as Super Admin
2. Dashboard calls `loadInspections(userId)` with the Super Admin's user ID
3. Offline storage filters to ONLY show reports where `inspector_id === superAdminId`
4. Network data loads, but if slow/failed, user only sees their own reports
5. **Result**: Super Admin sees incomplete report list

### Solution
Create a `isSuperAdmin` flag check and pass it to offline storage functions so Super Admins bypass the user filtering:

**Files to Modify:**
- `src/lib/offline-storage.ts`: Add super admin bypass to `getOfflineInspections`, `getOfflineTrainings`, `getOfflineDailyAssessments`
- `src/pages/Dashboard.tsx`: Pass super admin status to offline storage functions

---

## Issue 2: Missing Database Index

### Problem
The `is_super_admin()` function is called on every page load, every auth state change, and within RLS policy evaluation. Current index:

```sql
-- Existing index
CREATE UNIQUE INDEX user_roles_user_id_organization_id_role_key 
ON public.user_roles USING btree (user_id, organization_id, role)
```

This index includes `organization_id` in the middle, but the `is_super_admin()` function queries:
```sql
WHERE user_id = auth.uid() AND role = 'super_admin'
```

This query skips `organization_id`, reducing index efficiency. The query plan shows it's still using the index, but with "Heap Fetches".

### Solution
Add a dedicated index for super admin lookups:

```sql
CREATE INDEX idx_user_roles_super_admin_lookup 
ON public.user_roles (user_id, role) 
WHERE role = 'super_admin';
```

This partial index will:
- Be very small (only super admin entries)
- Provide direct lookup without heap fetches
- Speed up all RLS policy evaluations for super admins

---

## Issue 3: Super Admin Status Caching

### Problem
The Dashboard makes multiple redundant `is_super_admin()` RPC calls:
1. React Query hook (line 109-159)
2. `useReportEditPermission` hook calls it per-report
3. `useRequireSuperAdmin` hook calls it independently

Each call takes ~0.8ms at the database, but network latency multiplies this.

### Solution
Enhance the existing caching pattern to:
1. Store super admin status in memory with session lifetime
2. Single-flight pattern to dedupe concurrent requests
3. Invalidate on auth state changes

**File to Modify:**
- `src/lib/cached-auth.ts`: Add `getSuperAdminStatusWithCache()` function
- `src/hooks/useReportEditPermission.tsx`: Use cached function
- `src/pages/Dashboard.tsx`: Use cached function

---

## Implementation Details

### Change 1: Offline Storage Super Admin Bypass

**File: `src/lib/offline-storage.ts`**

Update function signatures to accept optional `isSuperAdmin` parameter:

```typescript
// Updated getOfflineInspections
export async function getOfflineInspections(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allInspections = await db.getAll('inspections');
      
      // Super admins see all reports
      if (isSuperAdmin) {
        return allInspections;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return allInspections.filter(i => i.inspector_id === userId);
      }
      
      return allInspections;
    },
    [],
    'getOfflineInspections'
  );
}
```

Same pattern for `getOfflineTrainings` and `getOfflineDailyAssessments`.

### Change 2: Dashboard Integration

**File: `src/pages/Dashboard.tsx`**

Update load functions to pass super admin status:

```typescript
// Line ~282-286
const loadInspections = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean) => {
  try {
    const userId = cachedUserId || (await getUserWithCache())?.id;
    
    // Pass super admin status to offline storage
    const offlinePromise = getOfflineInspections(userId, cachedIsSuperAdmin).catch(() => []);
    // ... rest of function
```

Update `loadAllData` to check super admin status once and pass to all loaders:

```typescript
const loadAllData = async () => {
  setLoading(true);
  
  const user = await getUserWithCache();
  const userId = user?.id;
  
  // Check super admin status once for offline storage bypass
  let superAdminStatus = false;
  if (user && navigator.onLine) {
    const { data } = await supabase.rpc('is_super_admin');
    superAdminStatus = !!data;
  }
  
  // Pass to all loaders
  await Promise.all([
    loadInspections(userId, superAdminStatus),
    loadTrainingReports(userId, superAdminStatus),
    loadDailyAssessments(userId, superAdminStatus)
  ]);
  // ...
```

### Change 3: Database Index

**SQL Migration:**

```sql
-- Add optimized index for super admin lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_super_admin_lookup 
ON public.user_roles (user_id, role) 
WHERE role = 'super_admin';

-- Analyze to update query planner statistics
ANALYZE public.user_roles;
```

### Change 4: Cached Super Admin Status

**File: `src/lib/cached-auth.ts`**

Add new cached function:

```typescript
// Super admin status cache
let cachedSuperAdminStatus: boolean | null = null;
let superAdminCacheTimestamp: number = 0;
let pendingSuperAdminPromise: Promise<boolean> | null = null;
const SUPER_ADMIN_CACHE_TTL = 120000; // 2 minutes

export async function getSuperAdminStatusWithCache(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (cachedSuperAdminStatus !== null && (now - superAdminCacheTimestamp) < SUPER_ADMIN_CACHE_TTL) {
    return cachedSuperAdminStatus;
  }
  
  // Single-flight pattern
  if (pendingSuperAdminPromise) {
    return pendingSuperAdminPromise;
  }
  
  // Check localStorage for offline fallback
  const localCached = localStorage.getItem('cached-super-admin-status');
  if (!navigator.onLine && localCached !== null) {
    return localCached === 'true';
  }
  
  pendingSuperAdminPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('is_super_admin');
      if (error) throw error;
      
      const status = !!data;
      cachedSuperAdminStatus = status;
      superAdminCacheTimestamp = Date.now();
      localStorage.setItem('cached-super-admin-status', status.toString());
      
      return status;
    } catch (error) {
      console.warn('[CachedAuth] Error checking super admin status:', error);
      return localCached === 'true';
    } finally {
      pendingSuperAdminPromise = null;
    }
  })();
  
  return pendingSuperAdminPromise;
}

export function invalidateSuperAdminCache() {
  cachedSuperAdminStatus = null;
  superAdminCacheTimestamp = 0;
}
```

### Change 5: Version Bump

Update `vite.config.ts` to version **2.3.6**.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/offline-storage.ts` | Add `isSuperAdmin` param to 3 get functions |
| `src/pages/Dashboard.tsx` | Pass super admin status to offline storage |
| `src/lib/cached-auth.ts` | Add `getSuperAdminStatusWithCache()` |
| `src/hooks/useReportEditPermission.tsx` | Use cached super admin function |
| `vite.config.ts` | Version bump to 2.3.6 |
| *Database Migration* | Add partial index on user_roles |

---

## Expected Outcomes

After implementation:

1. **Super Admins see ALL reports immediately** - Offline storage won't filter by user ID
2. **Faster RLS policy evaluation** - Partial index eliminates heap fetches
3. **Reduced API calls** - Single-flight cached super admin check
4. **Current/Future Super Admins covered** - All fixes are role-based, not user-specific

---

## Testing Checklist

1. Super Admin logs in and immediately sees all reports (before network loads)
2. Super Admin sees correct count: 6 inspections, 5 trainings, 5 daily assessments
3. Regular user still only sees their own reports
4. Offline mode: Super Admin still sees all previously cached reports
5. Performance: Dashboard loads in under 2 seconds
6. No regression on image upload functionality

