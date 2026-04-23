

## Phase 2 — Offline-Auth Hardening (Revised)

Three security wins kept as-is, plus a softened sign-out behavior so offline users never lose access to their own device.

---

### C4 — Stop storing passwords on the device

Replace the XOR+base64 password blob in IndexedDB with the **Supabase refresh token** captured at last successful sign-in.

- On successful online sign-in: store `{ userId, email, refreshToken, capturedAt }` in IDB (`offline_auth` store), keyed by email.
- On offline sign-in attempt: look up by email, accept if a refresh token exists for that email. Build the synthetic session (see C5) using the cached `userId`/`email`. The refresh token itself is never used offline — it just proves "this user has signed in successfully on this device before."
- On reconnect: `verifyAndReconcileOfflineAuth` calls `supabase.auth.refreshSession({ refresh_token })`. If it succeeds, the real session replaces the synthetic one. If it fails (revoked/expired), the entry is deleted and the user is forced to sign in online.
- On any failed offline sign-in: delete that email's entry immediately.
- One-time migration on app boot: wipe the legacy XOR password blob (`offline_passwords` store contents) so old credentials don't linger.

Files: `src/lib/offline-auth.ts`, `src/components/Auth.tsx` (capture refresh token after `signInWithPassword`), `src/main.tsx` (boot migration).

---

### C5 — Separate the synthetic session from Supabase's real session storage

Stop writing the placeholder session to `sb-{ref}-auth-token`.

- New storage key: `offline_synthetic_session` (localStorage).
- Drop the year-2286 `expires_at`. Use `capturedAt + 30 days` so a forgotten offline session eventually requires online re-auth.
- Update read paths in priority order:
  1. `src/pages/Index.tsx` — when offline, check `offline_synthetic_session` only; when online, check Supabase's real key only.
  2. `src/lib/cached-auth.ts` — `getUserWithCache` reads the synthetic slot only as an offline fallback; never returns the placeholder token to anything that hits the network.
  3. `src/components/AuthenticatedHeader.tsx` — same pattern.
- Add a guard: if any code path detects `access_token === 'offline_placeholder_token'` reaching `supabase.from(...)` or `supabase.functions.invoke(...)`, abort the call and log a dev warning. Defense in depth.

Files: `src/lib/offline-auth.ts`, `src/pages/Index.tsx`, `src/lib/cached-auth.ts`, `src/components/AuthenticatedHeader.tsx`, plus a small `src/lib/synthetic-session-guard.ts` helper.

---

### C6 — Service-worker message origin & shape validation

Tighten both worker scripts so they only accept tokens from a controlled, same-origin client.

- In `public/sw-push.js` and `public/sw-sync.js`, in every `message` handler:
  - Reject if `event.source` is null or `event.source.type !== 'window'`.
  - Reject if `event.source.url`'s origin !== `self.location.origin`.
  - For `AUTH_TOKEN` messages: reject if `accessToken` is missing, not a string, or doesn't match `^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` (JWT shape). Also reject the literal `offline_placeholder_token` (ties into C5).
- Log rejections to SW console with a stable prefix so we can grep deploy logs.

Files: `public/sw-push.js`, `public/sw-sync.js`. (Also a small typed wrapper in `src/lib/cached-auth.ts` to ensure we never *send* a malformed token.)

---

### H11 (revised) — Connection-aware sign-out

Sign-out behavior depends on whether the device is online.

**Online sign-out (today's behavior, made consistent):**
- Call `supabase.auth.signOut()`.
- Immediately clear:
  - Supabase real session key (`sb-{ref}-auth-token`)
  - `offline_synthetic_session`
  - All `offline_auth` IDB entries for the signing-out user
  - All `cached-admin-status:${userId}` / `cached-true-super-admin:${userId}` keys (per Phase 3)
  - In-memory `cachedUser`, profile cache
- Navigate to `/`.

**Offline sign-out (new, the user's requested behavior):**
- Detect via `!navigator.onLine`.
- Clear *only* the visible session state so the UI returns to the sign-in screen:
  - `offline_synthetic_session` (so Index.tsx doesn't auto-redirect back to /dashboard)
  - In-memory `cachedUser`
  - Navigate to `/`.
- **Keep**:
  - The `offline_auth` IDB entry (so the user can sign back in offline immediately).
  - The cached profile and cached admin status (re-used on next offline sign-in).
- Set a `localStorage` flag `pending_offline_signout: { userId, queuedAt }`.
- On the **next** successful online auth check (in `Index.tsx`'s online branch and in `useAutoSync`'s reconnect handler), if `pending_offline_signout.userId` matches the now-online user OR the user is signed out online: run the full online-sign-out cleanup (revoke refresh token via `supabase.auth.signOut({ scope: 'local' })` if a session is present, delete the `offline_auth` entry, clear admin caches), then clear the flag.
- If a *different* user signs in (online or offline) before the flag is processed: drop the queued cleanup for the old user and clear the flag — the new user's session takes precedence and we shouldn't touch their state.

Files: `src/pages/Dashboard.tsx` (handleSignOut), `src/components/AuthenticatedHeader.tsx` (handleSignOut), `src/lib/cached-auth.ts` (new `clearSessionState` + `processQueuedSignout` helpers), `src/lib/offline-auth.ts`, `src/pages/Index.tsx` (call `processQueuedSignout` in the online branch), `src/hooks/useAutoSync.tsx` (call it on the `online` event).

---

### Files touched (summary)

- `src/lib/offline-auth.ts` — refresh-token-based offline auth, drop password storage, legacy migration, queued-signout helpers
- `src/lib/cached-auth.ts` — synthetic-session read path, single-flight guard, sign-out helpers, queued cleanup
- `src/lib/synthetic-session-guard.ts` — **new**, tiny helper that asserts no placeholder token escapes to the network
- `src/components/Auth.tsx` — capture refresh token after successful online sign-in
- `src/components/AuthenticatedHeader.tsx` — connection-aware sign-out
- `src/pages/Dashboard.tsx` — connection-aware sign-out, process queued signout on focus
- `src/pages/Index.tsx` — read synthetic session from new slot, run queued signout in online branch
- `src/hooks/useAutoSync.tsx` — process queued signout on `online` event
- `src/main.tsx` — one-time migration: wipe legacy `offline_passwords` IDB contents
- `public/sw-push.js` — message origin + JWT-shape validation
- `public/sw-sync.js` — message origin + JWT-shape validation

No DB migrations. No edge function changes. No new secrets.

---

### Risk

- **C4**: If a user signs in online once, then their refresh token is revoked server-side (e.g. password change from another device), their offline sign-in still appears to work locally — but the next reconnect immediately fails the refresh and forces re-auth. Acceptable: same blast radius as a stolen device today, minus the cleartext-equivalent password.
- **C5**: Any code path that still reaches into Supabase's localStorage key directly will break offline. Mitigated by the synthetic-session-guard helper which logs in dev when a bad token leaks.
- **H11 revised**: Offline sign-out is now a "soft" sign-out — anyone who picks up the unlocked device can sign back in offline as the previous user. This is an explicit trade-off the user requested (keep offline access). Worth a short note in the UI ("Signed out — you can sign back in offline") so users aren't surprised.

---

### Verification

1. Fresh install → online sign-in → kill network → restart browser → sign in offline → reach dashboard. Refresh token (not password) is what's stored in IDB.
2. Online sign-out → `offline_auth` entry for that user is gone, synthetic session is gone, admin cache is gone, `/dashboard` direct-nav redirects to `/`.
3. **Offline sign-out → land on `/` → sign in offline again immediately → reach dashboard.** No re-typing of credentials needed beyond the offline form.
4. Offline sign-out → reconnect (no further user action) → background cleanup runs → refresh token revoked server-side → `offline_auth` entry deleted → admin cache cleared.
5. Offline sign-out → different user signs in online before reconnect → queued cleanup is dropped, new user's session is untouched.
6. Manually post `{ type: 'AUTH_TOKEN', accessToken: 'garbage' }` to the SW → rejected, dev console shows `[SW] rejected message: …`.
7. `offline_placeholder_token` is never observed in any Supabase network request (verified via DevTools Network panel).
8. Legacy device with old XOR password blob → first boot of new build wipes it from IDB; user is prompted to sign in online once to capture a refresh token.

