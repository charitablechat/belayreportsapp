

# Offline Sign-In and Deferred Authentication

## Problem

When a user is offline and has no cached session in localStorage (new device, cleared data, or expired session fully purged), the Auth screen blocks them with "Sign in requires an internet connection." They cannot access the app at all, despite the app having full offline-capable IndexedDB infrastructure. The screenshot shows this exact blocker.

## Solution Overview

Implement a "trust then verify" offline authentication system:

1. Allow users to enter email and password while offline and tap "Sign In"
2. Create a synthetic session in localStorage so all existing offline code paths work
3. Store the credentials securely for deferred server-side verification
4. When connectivity returns, automatically verify credentials with the backend
5. If the real user ID differs from the synthetic one, migrate all IndexedDB records

All data entered while in offline-auth mode is permanently stored in IndexedDB and will sync when the user comes back online after successful verification.

## Architecture

### Data Flow

```text
OFFLINE SIGN-IN:
  User enters email + password
      |
      v
  Store credentials in IndexedDB (offline_auth store)
      |
      v
  Create synthetic session in localStorage
  (uses cached real userId if available, otherwise generates one)
      |
      v
  Navigate to Dashboard -> All offline operations work normally

WHEN BACK ONLINE:
  Detect pending offline auth
      |
      v
  Call signInWithPassword with stored credentials
      |
      +---> SUCCESS: Real session replaces synthetic
      |        |
      |        v
      |     If real userId != synthetic userId:
      |        Migrate all IndexedDB records
      |        |
      |        v
      |     Clear stored credentials
      |     Trigger background sync
      |
      +---> FAILURE: Show persistent warning
               |
               v
            User can re-enter credentials
            Data is NOT deleted (stays in IndexedDB)
```

## File Changes

### 1. New File: `src/lib/offline-auth.ts`

Core module for offline authentication. Responsibilities:

- **`saveUserMapping(email, userId)`**: Called on every successful online sign-in. Stores the email-to-userId mapping in a dedicated IndexedDB store (`offline_auth`). This is the key enabler -- when a returning user signs in offline, we can use their REAL user ID, preventing any data migration issues.

- **`getStoredUserId(email)`**: Looks up a previously-cached real user ID for the given email. Returns null for brand-new users.

- **`createOfflineSession(email, password)`**: The main offline sign-in function:
  1. Check if we have a stored userId for this email (from a previous successful login)
  2. If yes, use the real userId (data will match existing IndexedDB records)
  3. If no, generate a deterministic UUID from a SHA-256 hash of the email (ensures same email always produces same ID across sessions)
  4. Store the raw password temporarily in IndexedDB (encrypted with Web Crypto if available) for deferred verification
  5. Create a synthetic session object in localStorage that matches the Supabase session format:
     ```json
     {
       "access_token": "offline_placeholder_token",
       "refresh_token": "offline_placeholder",
       "expires_at": 9999999999,
       "user": {
         "id": "<real or generated userId>",
         "email": "user@example.com",
         "app_metadata": {},
         "user_metadata": {},
         "aud": "authenticated"
       }
     }
     ```
  6. Set a flag: `localStorage.setItem('offline_auth_pending', 'true')`

- **`hasPendingOfflineAuth()`**: Returns true if there are unverified offline credentials

- **`verifyAndReconcileOfflineAuth()`**: Called when the app detects online connectivity:
  1. Read stored email + password from IndexedDB
  2. Call `supabase.auth.signInWithPassword({ email, password })`
  3. On success:
     - The real Supabase session replaces the synthetic one automatically
     - If the real user ID differs from the synthetic one, call `migrateUserData(syntheticId, realId)`
     - Save the email-to-userId mapping for future offline logins
     - Clear stored credentials and pending flag
  4. On failure:
     - Show a persistent toast: "Could not verify your offline credentials. Please sign in again."
     - Do NOT destroy user data
     - Clear the pending flag but keep data intact

- **`migrateUserData(oldUserId, newUserId)`**: Sweeps all IndexedDB stores and updates `inspector_id` fields from oldUserId to newUserId. Affects: `inspections`, `trainings`, `daily_assessments`, and all child stores.

- **`clearOfflineAuth()`**: Removes stored credentials and pending flag (called on sign-out)

### 2. Modify: `src/components/Auth.tsx`

**Changes:**

- Import `createOfflineSession` from `offline-auth.ts`
- In the `handleAuth` function, add an offline branch BEFORE the Supabase call:
  ```
  if (!isOnline && !isSignUp) {
    // Offline sign-in: create synthetic session
    await createOfflineSession(email, password);
    navigate("/dashboard", { replace: true });
    return;
  }
  ```
- Block sign-UP while offline (still requires internet for account creation) but allow sign-IN
- Update the offline warning message from "Sign in requires an internet connection" to "You're offline. Your credentials will be verified when you reconnect." for the sign-in case
- Keep the existing "Go to Dashboard" button for users who already have a cached session (the fast path)

### 3. Modify: `src/pages/Index.tsx`

**Changes:**

- Import `hasPendingOfflineAuth` from `offline-auth.ts`
- In the offline check block (lines 15-37), also check `hasPendingOfflineAuth()`:
  ```
  if (!navigator.onLine) {
    // Check for existing cached session OR pending offline auth
    if (cachedSession || hasPendingOfflineAuth()) {
      navigate("/dashboard", { replace: true });
      return;
    }
  }
  ```
  This ensures that if the user force-closes and reopens the app while still offline, they're not kicked back to the login screen.

### 4. Modify: `src/lib/cached-auth.ts`

**Changes:**

- Import `saveUserMapping` from `offline-auth.ts`
- In the `getUserWithCache()` function's network success path (when a real user is fetched), call `saveUserMapping(user.email, user.id)` to cache the email-to-userId mapping for future offline logins. This is a fire-and-forget call (no await needed).
- In the `invalidateUserCache()` function, also call `clearOfflineAuth()` to clean up stored credentials on sign-out

### 5. Modify: `src/hooks/useAutoSync.tsx`

**Changes:**

- Import `hasPendingOfflineAuth`, `verifyAndReconcileOfflineAuth` from `offline-auth.ts`
- In the `handleOnline` callback (line 320-325), add a check BEFORE performing sync:
  ```
  if (hasPendingOfflineAuth()) {
    try {
      await verifyAndReconcileOfflineAuth();
      // After successful verification, proceed with normal sync
    } catch (e) {
      console.warn('[AutoSync] Offline auth verification failed:', e);
      // Don't block sync -- data is still local
    }
  }
  ```
  This ensures credentials are verified and user IDs are reconciled before any data sync attempts, preventing RLS failures.

### 6. Modify: `src/pages/NewInspection.tsx`, `src/pages/NewTraining.tsx`, `src/pages/NewDailyAssessment.tsx`

**Minor safety change:**

- In the `getUserWithCache()` check, change the "Not authenticated" error to a user-friendly toast instead of throwing, and avoid redirecting to login when offline:
  ```
  const user = await getUserWithCache();
  if (!user) {
    if (!navigator.onLine) {
      toast.error("Please sign in to create reports");
      return;
    }
    navigate("/", { replace: true });
    return;
  }
  ```
  This prevents an edge case where `getUserWithCache()` somehow returns null while offline with a synthetic session (defensive guard).

## Security Considerations

- **Password storage**: The raw password must be stored temporarily to enable deferred verification. It is stored in IndexedDB (origin-scoped, not accessible to other sites). It is cleared immediately after successful verification. For additional protection, the password can be encrypted using the Web Crypto API with a key derived from the email and a fixed salt.
- **Sign-up blocked offline**: Only sign-IN is allowed offline. Creating new accounts still requires internet.
- **Data integrity**: If credentials are wrong, data is NOT destroyed. The user is warned and can re-enter credentials. Data stays in IndexedDB and remains accessible.
- **Shared devices**: The `inspector_id` filtering in IndexedDB still works correctly since each offline user gets their own userId (real or generated).

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Returning user, offline, device has cached userId mapping | Uses real userId -- seamless, no migration needed |
| Brand new user, offline, never logged in on any device | Gets deterministic generated userId. On online verification, data migrates to real userId |
| User enters wrong password offline | Allowed in. When online, verification fails. User warned, data preserved |
| User signs in offline, creates reports, force-closes app, reopens offline | Synthetic session persists in localStorage, user goes straight to Dashboard |
| User signs in offline, creates reports, comes online, sync triggers | Credentials verified first, then userId reconciled, then normal sync proceeds |
| Multiple offline sign-ins with same email | Same deterministic userId used each time (consistent) |
| User signs out (clears session) | `clearOfflineAuth()` called, credentials removed |

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/lib/offline-auth.ts` | **Create** | Core offline auth module with credential storage, session creation, deferred verification, and data migration |
| `src/components/Auth.tsx` | **Modify** | Enable offline sign-in flow, update warning messages |
| `src/pages/Index.tsx` | **Modify** | Recognize pending offline auth sessions |
| `src/lib/cached-auth.ts` | **Modify** | Save email-to-userId mappings on successful auth, clear offline auth on sign-out |
| `src/hooks/useAutoSync.tsx` | **Modify** | Verify offline credentials before sync on reconnect |
| `src/pages/NewInspection.tsx` | **Modify** | Defensive guard for offline user state |
| `src/pages/NewTraining.tsx` | **Modify** | Defensive guard for offline user state |
| `src/pages/NewDailyAssessment.tsx` | **Modify** | Defensive guard for offline user state |

## What Does NOT Change

- IndexedDB schema and offline storage logic (already fully offline-capable)
- All form pages (Inspection, Training, Daily Assessment) -- they already work offline with cached auth
- Background sync / atomic sync manager -- unchanged
- Dashboard data loading logic -- already handles offline data from IndexedDB
- PWA service worker configuration
- UserProfileDropdown component
- goBack(navigate) navigation logic

