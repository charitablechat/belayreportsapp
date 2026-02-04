
# Plan: Fix "Loading Inspection" Stuck Screen

## Problem Analysis

The loading screen gets stuck because the `loadInspection` function in `InspectionForm.tsx` lacks timeout protection for Supabase database queries. While IndexedDB operations have 3-5 second timeouts (confirmed working from console logs), the Supabase queries can hang indefinitely, preventing the loading state from ever resolving.

**Evidence from Console Logs:**
```
[Atomic Sync] IndexedDB timeout getting unsynced inspections
[Atomic Sync] IndexedDB timeout getting unsynced trainings
[Atomic Sync] IndexedDB timeout getting unsynced assessments
```

The IndexedDB timeout handling works, but the main loading is stuck on unprotected Supabase queries.

---

## Technical Solution

### 1. Add Safety Timeout to loadInspection Function

**File:** `src/pages/InspectionForm.tsx`

Wrap the entire loading process with a safety timeout that forces the loading state to resolve:

```typescript
const loadInspection = async () => {
  // Safety timeout - force loading to complete after 15 seconds max
  const LOAD_TIMEOUT = 15000;
  let loadCompleted = false;
  
  const safetyTimeout = setTimeout(() => {
    if (!loadCompleted) {
      console.error('[InspectionForm] Loading timeout - forcing completion');
      setLoading(false);
      toast({
        title: "Loading timed out",
        description: "Please check your connection and try again.",
        variant: "destructive",
      });
    }
  }, LOAD_TIMEOUT);

  try {
    // ... existing loading logic with Supabase query timeouts
  } finally {
    loadCompleted = true;
    clearTimeout(safetyTimeout);
    setLoading(false);
  }
};
```

### 2. Add Timeout Protection to Individual Supabase Queries

Wrap each Supabase query with `Promise.race` to prevent any single query from blocking:

```typescript
// Helper function for Supabase query timeouts
const withQueryTimeout = async <T,>(
  queryPromise: Promise<T>,
  timeoutMs: number = 8000,
  fallback: T
): Promise<T> => {
  return Promise.race([
    queryPromise,
    new Promise<T>((resolve) => setTimeout(() => {
      console.warn('[InspectionForm] Query timed out after', timeoutMs, 'ms');
      resolve(fallback);
    }, timeoutMs))
  ]);
};

// Usage for each query:
const { data, error } = await withQueryTimeout(
  supabase.from("inspections").select("...").eq("id", id).maybeSingle(),
  8000,
  { data: null, error: null }
);
```

### 3. Improve Loading UI with Spinner and Retry Option

**Current (Line 1627-1632):**
```tsx
if (loading) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p>Loading inspection...</p>
    </div>
  );
}
```

**Improved:**
```tsx
if (loading) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading inspection...</p>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => navigate('/dashboard')}
          className="mt-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}
```

---

## Implementation Details

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/InspectionForm.tsx` | Add safety timeout, query timeouts, improved loading UI |
| `vite.config.ts` | Increment version to v2.1.30 |

### Timeout Configuration

| Operation | Timeout | Fallback Behavior |
|-----------|---------|-------------------|
| Overall loading | 15 seconds | Force complete, show error toast, allow retry |
| Individual Supabase query | 8 seconds | Skip query, use offline data if available |
| IndexedDB operations | 3-5 seconds | Already implemented, return empty fallback |

### Specific Code Changes

**1. Add helper function (after line 508):**
```typescript
// Timeout wrapper for Supabase queries
const withQueryTimeout = async <T,>(
  queryPromise: Promise<{ data: T | null; error: any }>,
  timeoutMs: number = 8000
): Promise<{ data: T | null; error: any }> => {
  return Promise.race([
    queryPromise,
    new Promise<{ data: T | null; error: any }>((resolve) => setTimeout(() => {
      console.warn('[InspectionForm] Supabase query timed out after', timeoutMs, 'ms');
      resolve({ data: null, error: new Error('Query timeout') });
    }, timeoutMs))
  ]);
};
```

**2. Wrap Supabase queries (lines 667-780):**
- `update({ last_opened_at: now })` - add 5s timeout
- `select("*").eq("id", id)` - add 8s timeout  
- `select("*").eq("inspection_id", id)` for systems, ziplines, equipment, standards, summary - add 8s timeout each

**3. Add safety timeout at start of loadInspection:**
```typescript
const loadInspection = async () => {
  const LOAD_TIMEOUT = 15000;
  let loadCompleted = false;
  
  const safetyTimeout = setTimeout(() => {
    if (!loadCompleted) {
      console.error('[InspectionForm] Safety timeout triggered');
      setLoading(false);
      toast({
        title: "Loading timed out",
        description: "The inspection is taking too long to load. Please try again.",
        variant: "destructive",
      });
    }
  }, LOAD_TIMEOUT);
  
  try {
    // ... existing code
  } finally {
    loadCompleted = true;
    clearTimeout(safetyTimeout);
    setLoading(false);
  }
};
```

**4. Update loading UI (lines 1627-1633):**
Add spinner animation and back button for better UX.

---

## Version Update

Increment to `v2.1.30` in `vite.config.ts`:
```typescript
// v2.1.30 - Loading timeout protection: safety timeout for inspection loading, Supabase query timeouts, improved loading UI
const APP_VERSION = "2.1.30";
```

---

## Testing Checklist

After implementation, verify:
- [ ] Loading screen shows spinner animation instead of just text
- [ ] Loading screen includes "Back to Dashboard" button
- [ ] If network is slow, loading times out after ~15 seconds with error toast
- [ ] App doesn't get stuck on loading screen indefinitely
- [ ] Offline data is still used when available
- [ ] Works correctly on both desktop and mobile
- [ ] Version badge shows v2.1.30

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Timeouts too aggressive | 15s overall + 8s per query is generous; offline fallback prevents data loss |
| False timeout on slow connections | Offline data displayed first (from IndexedDB), Supabase just updates |
| User confusion on timeout | Clear error message with retry suggestion |
