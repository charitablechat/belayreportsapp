

# Offline Profile Autopopulation for New Reports

## Problem
When creating a new report offline, the user's name and ACCT number fields are blank because the profile fetch (`supabase.from('profiles').select(...)`) requires network access.

## Solution
Cache the user's profile in `localStorage` on every successful fetch, then use that cache as a fallback when offline or when the fetch fails.

## Changes

### 1. `src/lib/profile-cache.ts` — Add localStorage persistence

Add two helper functions alongside the existing in-memory cache:
- `persistProfileToLocalStorage(userId, profile)` — saves `{first_name, last_name, avatar_url, acct_number}` to `localStorage` under a key like `cached_profile_<userId>`
- `getPersistedProfile(userId)` — reads the localStorage entry (no TTL — this is a "last known good" fallback)

Update the existing `getCachedProfile()` function to:
1. Include `acct_number` in the select query (currently missing)
2. Call `persistProfileToLocalStorage()` on successful DB fetch
3. Fall back to `getPersistedProfile()` when the DB fetch returns null or times out

### 2. `src/pages/NewInspection.tsx` — Use cached profile offline

Update the `fetchUserProfile` useEffect (lines 103–131):
- Import and use `getCachedProfile()` instead of a raw Supabase query
- If `getUserWithCache()` returns null (offline, no cached user), use `getOfflineUserId()` to get the userId and call `getCachedProfile()` which will return the localStorage fallback
- This ensures name + ACCT number are populated from the last successful login

### 3. `src/pages/NewTraining.tsx` — Use cached profile offline

Same pattern as NewInspection (lines 35–59): replace raw Supabase query with `getCachedProfile()` + offline userId fallback.

### 4. `src/pages/NewDailyAssessment.tsx` — Use cached profile offline

Same pattern (lines 35–59): replace raw Supabase query with `getCachedProfile()` + offline userId fallback.

## How It Works

```text
Online login → profile fetched from DB → saved to localStorage
                                        → saved to in-memory cache

Later, offline → getUserWithCache() → null
              → getOfflineUserId() → userId from localStorage session
              → getCachedProfile(userId) → reads localStorage fallback
              → name + ACCT number populated ✓
```

## No Risk of Stale Data
- localStorage profile is refreshed on every successful online profile fetch
- The data (name, ACCT number) rarely changes — staleness is not a practical concern
- No sensitive tokens or secrets are stored — only display name and account number

