

# Fix: Sign-Out Stuck on Spinner

## Root Cause

The `onAuthStateChange` callback in `src/hooks/useReportEditPermission.tsx` (line 80) is `async` and contains `await Promise.all([getSuperAdminStatusWithCache(), getIsTrueSuperAdmin()])`. This blocks the Supabase auth-js event pipeline — when sign-out fires, this listener's `await` creates a deadlock that prevents subsequent auth events (including the `SIGNED_OUT` event) from propagating. The spinner never stops because `setSigningOut(false)` is only called in the `catch` block, and the navigation to `/` never fires because `SIGNED_OUT` never reaches the other listeners.

## Fix

### 1. Remove `await` from `useReportEditPermission.tsx` `onAuthStateChange` callback

Change the `async` callback to fire-and-forget:

```typescript
// BEFORE (deadlocks):
supabase.auth.onAuthStateChange(async (_event, session) => {
  // ...
  const [adminStatus, trueSuperAdminStatus] = await Promise.all([...]);
  // ...
});

// AFTER (fire-and-forget):
supabase.auth.onAuthStateChange((_event, session) => {
  const newUserId = session?.user?.id;
  if (newUserId) {
    setCurrentUserId(newUserId);
  } else if (navigator.onLine) {
    setCurrentUserId(null);
  }

  if (session?.user) {
    // Fire and forget — do NOT await inside onAuthStateChange
    Promise.all([
      getSuperAdminStatusWithCache(),
      getIsTrueSuperAdmin()
    ]).then(([adminStatus, trueSuperAdminStatus]) => {
      setIsAdmin(adminStatus);
      setIsTrueSuperAdmin(trueSuperAdminStatus);
    }).catch(() => {});
  } else if (navigator.onLine) {
    // ... existing cache checks (synchronous, no change needed)
  }
});
```

### 2. Add safety reset for `signingOut` state in `AuthenticatedHeader.tsx`

Add `setSigningOut(false)` after `signOut()` resolves (not just in `catch`), so even if the navigation doesn't happen immediately, the button isn't stuck:

```typescript
const handleSignOut = async () => {
  setSigningOut(true);
  try {
    // ... existing sync logic ...
    await supabase.auth.signOut();
  } catch (error) {
    console.error("Error signing out:", error);
  } finally {
    setSigningOut(false);  // Always reset, not just on error
  }
};
```

## Files Changed
1. `src/hooks/useReportEditPermission.tsx` — remove `async`/`await` from `onAuthStateChange` callback
2. `src/components/AuthenticatedHeader.tsx` — move `setSigningOut(false)` to `finally` block

