## Diagnosis

The sign-in form is stuck on "Please wait..." because **the Lovable Cloud backend (your Supabase project `ssgzcgvygnsrqalisshx`) is currently unresponsive**, not because of an app bug.

Evidence gathered just now:

- Direct HTTPS POST to `https://ssgzcgvygnsrqalisshx.supabase.co/auth/v1/token` — hangs 15s, 0 bytes received (HTTP `000`, curl exit 28 timeout).
- `supabase--read_query` (`select 1`) returns "Connection terminated due to connection timeout" (status 544).
- Auth logs for the entire visible window are empty — sign-in attempts are not even reaching the auth server.
- Edge function logs are empty.
- Earlier in this same conversation, Cloud metadata also failed with `SUPABASE_INTERNAL_ERROR`.

The Supabase JS client does not impose a client-side timeout on `signInWithPassword`, so when the API never responds the button label remains "Please wait..." indefinitely. From the user's perspective: nothing happens.

## Step 1 — Restore the backend (immediate, manual)

This is the only thing that will unblock real users right now. Code changes cannot fix an unreachable backend.

1. Open Cloud → check project status. If the instance is **paused**, **upgrading**, **restoring**, or shows an unhealthy state, resume / wait for it to return to healthy.
2. If status looks healthy but the API is still timing out, this is a Lovable Cloud platform incident — contact support; no migration or code change will help.

```text
<lov-actions>
  <lov-open-backend>Open Lovable Cloud</lov-open-backend>
</lov-actions>
```

## Step 2 — Make sign-in fail fast on future outages (code, ~15 lines)

Today, when the backend is unreachable the user sees "Please wait..." forever and assumes the app is broken. Add a 20 s timeout race around `supabase.auth.signInWithPassword` in `src/components/Auth.tsx` so the user gets a real error message instead.

Behavior after the change:

- Online sign-in races the Supabase call against a 20 s timeout.
- On timeout: show "Sign-in timed out. The service may be temporarily unavailable — please try again in a moment." via the existing `setError` + `toast.error` path. `loading` resets, button becomes clickable again.
- Successful sign-in path is unchanged.
- Offline sign-in path (`createOfflineSession`) is unchanged — it already returns synchronously.
- No change to auth-bridge, FSM, or RequireAuth.

### Technical detail

In `handleAuth` (Auth.tsx ~line 85), wrap the call:

```ts
const SIGN_IN_TIMEOUT_MS = 20_000;
const result = await Promise.race([
  supabase.auth.signInWithPassword({ email, password }),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('Sign-in timed out. The service may be temporarily unavailable — please try again in a moment.')),
      SIGN_IN_TIMEOUT_MS
    )
  ),
]);
```

The existing `catch` block already routes the message through `getAuthErrorMessage` + `toast.error` + `setError`, and `finally { setLoading(false) }` re-enables the button. We add a `'timed out'` branch to `getAuthErrorMessage` so the friendly message survives mapping.

## Step 3 — Optional follow-up (NOT in this change)

If outages become recurrent, we can later:

- Add the same timeout to `supabase.auth.getSession()` in `Index.tsx` (it already has a 5 s timeout — works correctly, just falls through to "show login form").
- Surface a global "Service degraded" banner driven by a lightweight health-ping. Out of scope for this hotfix.

## What I will change after approval

- `src/components/Auth.tsx` — add the 20 s race + map the timeout message in `getAuthErrorMessage`.

No DB migrations. No edge-function changes. No dependency changes.
