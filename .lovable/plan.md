# Fix offline access + add Guest Mode

## What's broken today

When a user opens the app offline they hit a dead-end: the sign-in screen with an orange "You're offline" banner and no usable path forward. Three independent gaps cause this:

1. **Refresh-token capture is fragile.** `saveUserMapping(email, userId, refreshToken)` only fires inside `onAuthStateChange` on `SIGNED_IN` / `TOKEN_REFRESHED` (cached-auth.ts L269) and inside `Auth.tsx` after a fresh login (L110). Users who signed in before this code shipped, or who are restored from a session refresh that didn't fire those events on this device, have **no `offline_auth` IDB entry** — so `createOfflineSession()` throws "No offline credentials available."
2. **No "Go to Dashboard" button when nothing is cached.** `Auth.tsx` only shows the offline shortcut when `hasCachedSessionForOffline()` is true. If both the Supabase session key (`sb-*-auth-token`) and the synthetic-session slot are empty, the user sees the offline banner but can't enter — typing a password just produces the "No offline credentials" error.
3. **No guest fallback.** A user who has truly never signed in on this device has no way in at all.

You confirmed the symptom matches #1/#2: "Just says I'm offline with a ropeworks logo. Couldn't do anything else."

## Solution overview

```text
┌──────────────────────────────────────────────────────────┐
│  Open app OFFLINE                                        │
│      │                                                   │
│      ▼                                                   │
│  Index.tsx                                               │
│      ├─ cached SB session?       ───► /dashboard         │
│      ├─ synthetic session?       ───► /dashboard         │
│      ├─ ANY offline_auth entry?  ───► /dashboard (auto   │
│      │                                  rebuild synthetic)│
│      └─ guest session in LS?     ───► /dashboard (guest) │
│                                                          │
│  Auth.tsx (no auto path)                                 │
│      ├─ enter email+pwd → createOfflineSession           │
│      │     └─ if entry → synthetic session, go           │
│      │     └─ if no entry → offer Guest Mode button      │
│      └─ "Continue offline as Guest" button (always shown │
│            when offline)                                 │
└──────────────────────────────────────────────────────────┘
```

## Changes

### 1. Capture refresh tokens opportunistically (closes gap #1)
- **`src/lib/cached-auth.ts`** — in `getUserWithCache()` and `ensureValidSession()`, after a successful Supabase fetch, read `supabase.auth.getSession()` once and call `saveUserMapping(email, id, refresh_token)` if a refresh token exists. Idempotent; only re-writes when the captured token differs.
- **`src/main.tsx`** — on boot, if online and a real Supabase session exists in localStorage, ensure an `offline_auth` IDB entry exists for that user. Backfills any user who signed in before refresh-token capture was wired up.

### 2. Auto-promote any captured offline_auth entry (closes gap #2)
- **`src/pages/Index.tsx`** — when offline, after the existing `localStorage[SUPABASE_SESSION_KEY]` check, also scan `offline_auth` IDB. If exactly one entry exists, silently call `createOfflineSession(entry.email, '')` (the function already ignores password) and navigate to `/dashboard`. If multiple entries exist, leave the user on the sign-in screen so they can pick which account.
- **`src/components/Auth.tsx`** — when offline AND `hasCachedSessionForOffline()` is false, asynchronously check if any `offline_auth` entry exists. If yes, show a "Resume offline session" shortcut listing the captured email(s).

### 3. Add Guest Mode (offline-only, local-only)
- **New file `src/lib/guest-session.ts`**
  - `createGuestSession()` — generates a deterministic UUID (`guest-<crypto.randomUUID>`), stores `{ id, email: null, isGuest: true, createdAt }` in a dedicated `guest_session` localStorage slot.
  - `readGuestSession()` / `clearGuestSession()` / `isGuestSession(user)`.
  - Guest sessions are **never** sent to the network. The existing `assertRealSessionForSync` / `safeFunctionsInvoke` guards already block the `offline_placeholder_token`; we extend them to also reject any user whose id starts with `guest-`.
- **`src/lib/cached-auth.ts`** — `getCachedUserFromStorage()` and `getOfflineUserId()` fall back to the guest session when offline and no real/synthetic session exists.
- **`src/components/Auth.tsx`** — when offline, always render a secondary "Continue offline as Guest" button under the main form. Clicking it creates a guest session and navigates to `/dashboard`.
- **`src/components/auth/RequireAuth.tsx`** — accept a guest session as authenticated (for offline only). Online, guest sessions are ignored and the user is redirected to sign in.
- **Visual marker** — `AuthenticatedHeader` shows a small "GUEST — OFFLINE ONLY" pill while a guest session is active so the user can't forget what mode they're in.

### 4. Block guest data from leaking online (security)
- **`src/lib/atomic-sync-manager.ts`** — `assertRealSessionForSync` rejects when the current cached user `id` starts with `guest-`. Sync becomes a no-op for guests; reports stay in IndexedDB only.
- **`src/lib/safe-functions-invoke.ts`** — same pre-flight: refuse to invoke any edge function under a guest identity.
- **Photo upload paths** — `pending/` photos captured as guest get the prefix `guest/<guestId>/...`; the existing storage RLS already blocks writes to any prefix that isn't `auth.uid()`, so even if a sync slipped through it would 401.

### 5. Claim guest data after a real sign-in
- **New file `src/components/auth/ClaimGuestDataDialog.tsx`** — when a real user signs in (online) and `readGuestSession()` is non-null AND the local IDB contains rows tagged with that guest id, show a one-time dialog:
  > "Found 3 reports created in Guest mode. Move them to your account?"
  - On **Yes**: rewrite `inspector_id` from the guest id to the real user id across `inspections`, `trainings`, `daily_assessments` (reuse the existing `migrateUserData` helper from `offline-auth.ts`), then `clearGuestSession()`. The next sync uploads them under the real user.
  - On **Discard**: hard-delete the rows from IDB and clear the guest session.
- Mounted from `RootLayout` so it runs once per session promotion.

### 6. Boot path resilience
- **`src/pages/Index.tsx`** — collapse the dual offline-detection logic into a single `resolveOfflineEntry()` helper that returns `{ kind: 'real' | 'synthetic' | 'capturedToken' | 'guest' | 'none' }` and routes accordingly. Easier to reason about and to add tests.

### Out of scope
- Native HIBP or password-strength changes.
- Online guest mode (would require anonymous Supabase sign-in and is a different security model — explicitly not doing it).
- Touching the SW registration / version-check stack.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Guest data accidentally syncs to a different real user | Sync guards (#4) reject any user id starting with `guest-`. Photo paths use `guest/` prefix that storage RLS will reject. |
| Auto-promote in Index.tsx grants the wrong user access on a shared device with multiple captured emails | Auto-promote only fires when there is exactly **one** `offline_auth` entry. Two or more → manual sign-in. |
| Backfilled refresh-token capture writes to IDB on every boot | Write only when the stored `refreshToken` differs from the live one. |

## Files touched
- `src/lib/cached-auth.ts`
- `src/lib/offline-auth.ts` (small helper export)
- `src/lib/atomic-sync-manager.ts`
- `src/lib/safe-functions-invoke.ts`
- `src/pages/Index.tsx`
- `src/components/Auth.tsx`
- `src/components/auth/RequireAuth.tsx`
- `src/components/layout/AuthenticatedHeader.tsx` (guest pill)
- `src/main.tsx` (boot backfill)
- **NEW** `src/lib/guest-session.ts`
- **NEW** `src/components/auth/ClaimGuestDataDialog.tsx`
- Memory: new `mem://auth/guest-mode-and-offline-resume` + index update
