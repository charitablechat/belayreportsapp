
# Fix Plan: Stuck Photo Upload Spinner - v2.4.4

## Root Cause Analysis

The photo upload spinner gets stuck because the `processFiles()` function in `PhotoCapture.tsx` has a **critical blocking point** that lacks timeout protection:

```typescript
// Line 195 - NO TIMEOUT WRAPPER
const user = await getUserWithCache();
if (!user) throw new Error("Not authenticated");
```

This call happens BEFORE the per-file timeout is applied (line 201), meaning:
1. User clicks "Take Photo" or "Upload"
2. `setUploading(true)` executes immediately (line 176)
3. `getUserWithCache()` is called (line 195)
4. If `supabase.auth.getUser()` hangs (session issues, slow network, etc.), the spinner stays forever
5. The 20-second safety timeout eventually fires, but that's too long

### Why `getUserWithCache()` Can Hang

The function at `src/lib/cached-auth.ts` line 91 calls:
```typescript
const { data: { user } } = await supabase.auth.getUser();
```

This Supabase call has **no internal timeout** and can stall indefinitely when:
- The auth token is in a bad state (needs refresh but refresh is slow)
- Network is unstable (connected but slow)
- The Supabase auth service is experiencing latency

### Issue Scope

This affects:
- **All report types**: Inspection photos, Training photos (if added), Daily Assessment photos
- **All platforms**: Web, iOS PWA, Android PWA
- **All users**: Anyone experiencing auth latency

---

## Solution

### Phase 1: Add Auth Timeout to PhotoCapture

Wrap the `getUserWithCache()` call in the same timeout pattern used for per-file processing.

**File: `src/components/PhotoCapture.tsx`**

```typescript
// Add new constant at top of file (around line 24)
const AUTH_TIMEOUT = 5000; // 5 seconds max for auth check

// Modify processFiles function (around line 194-196)
// BEFORE:
const user = await getUserWithCache();
if (!user) throw new Error("Not authenticated");

// AFTER:
const user = await Promise.race([
  getUserWithCache(),
  new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn('[PhotoCapture] Auth check timed out');
      resolve(null);
    }, AUTH_TIMEOUT)
  )
]);
if (!user) throw new Error("Not authenticated - please refresh the page");
```

### Phase 2: Add Timeout to `getUserWithCache()` Itself

For defense-in-depth, also add timeout protection to the auth utility itself so ALL callers are protected.

**File: `src/lib/cached-auth.ts`**

```typescript
// Add constant (around line 21)
const AUTH_NETWORK_TIMEOUT = 8000; // 8 seconds max for network auth fetch

// Modify the SLOW PATH section (around line 89-107)
// BEFORE:
pendingUserPromise = (async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    // ...
  }
})();

// AFTER:
pendingUserPromise = (async () => {
  try {
    const authPromise = supabase.auth.getUser();
    const result = await Promise.race([
      authPromise.then(res => ({ user: res.data.user, timedOut: false })),
      new Promise<{ user: null; timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ user: null, timedOut: true }), AUTH_NETWORK_TIMEOUT)
      )
    ]);
    
    if (result.timedOut) {
      console.warn('[CachedAuth] Auth network request timed out');
      return null;
    }
    
    if (result.user) {
      cachedUser = result.user;
      cacheTimestamp = Date.now();
    }
    
    return result.user;
  } catch (error) {
    console.error('[CachedAuth] Error fetching user:', error);
    return null;
  } finally {
    pendingUserPromise = null;
  }
})();
```

### Phase 3: Reduce Safety Timeout

The current 20-second `PROCESS_SAFETY_TIMEOUT` is too long for good UX. Reduce it:

**File: `src/components/PhotoCapture.tsx`**

```typescript
// BEFORE (line 23):
const PROCESS_SAFETY_TIMEOUT = 20000; // 20 seconds

// AFTER:
const PROCESS_SAFETY_TIMEOUT = 12000; // 12 seconds max (auth 5s + compression 3s + save 4s)
```

### Phase 4: Version Bump

Update version to **v2.4.4** in `vite.config.ts`.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/components/PhotoCapture.tsx` | Update | Add 5s auth timeout, reduce safety timeout to 12s |
| `src/lib/cached-auth.ts` | Update | Add 8s network timeout to `getUserWithCache()` slow path |
| `vite.config.ts` | Update | Bump version to v2.4.4 |

---

## Why These Specific Timeouts?

| Component | Timeout | Rationale |
|-----------|---------|-----------|
| Auth (PhotoCapture) | 5s | User-facing, needs fast feedback |
| Auth (cached-auth network) | 8s | Backend utility, slightly longer for reliability |
| Per-file processing | 10s | Compression + IndexedDB write |
| Safety timeout | 12s | 5s auth + 3s compression + 4s buffer |

---

## Expected Outcome

After this fix:
1. Photo upload will **never hang more than 12 seconds** (down from 20s)
2. Auth failures will be caught within 5 seconds with clear error message
3. The fix applies universally to **all users** and **all platforms**
4. Defense-in-depth: both PhotoCapture AND the auth utility are protected
5. Users see actionable error: "Not authenticated - please refresh the page"

---

## Testing Checklist

- [ ] Test photo upload on web browser (Chrome, Safari, Firefox)
- [ ] Test photo upload on iOS Safari PWA
- [ ] Test photo upload on Android Chrome PWA
- [ ] Simulate slow network to verify 5s auth timeout triggers
- [ ] Verify offline photo capture still works (falls back to local storage)
- [ ] Confirm "Pending" badge shows for unsynced photos
- [ ] Verify background sync uploads photos when online
