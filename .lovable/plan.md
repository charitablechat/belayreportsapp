

## RopeWorks Offline-Auth Hardening Plan

A staged defense plan to address the seven worst-case scenarios. Sequenced by impact and effort. Each phase is independently shippable.

---

### Phase 1 (P0) — Crash & Corruption Resilience

Goal: a session write that gets interrupted by a crash, force-quit, or storage glitch never leaves the user locked out.

**Atomic session writes**
- Introduce a `writeSessionAtomic(session)` helper in `src/lib/cached-auth.ts` and `src/lib/offline-auth.ts`.
- Pattern: write to `<key>.tmp` → fsync (await) → swap to `<key>` → delete `.tmp`. On boot, if `.tmp` exists, treat as incomplete and discard.

**Redundant token storage + checksums**
- Mirror the refresh token + offline user mapping into two slots: `offline-auth-primary` and `offline-auth-backup` (both in IndexedDB; localStorage is the legacy mirror only).
- Alongside each, store `{ payload, sha256, writtenAt }`. Verify SHA-256 on read; if primary fails, try backup; if both fail, surface a clear "credentials damaged — reconnect to sign in" UI in `Auth.tsx`.

**Write-confirm**
- After every credential write, immediately read back and verify hash. Retry up to 3× with exponential backoff. Only mark write successful after verify passes.

**Boot consistency check**
- New `validateAuthStateOnBoot()` runs in `main.tsx` before React mounts. Cross-checks: synthetic-session existence ↔ offline-user-id ↔ refresh-token slots ↔ Supabase session. Any inconsistency → force a clean offline-only state, log to a new `auth-recovery-log` ring buffer, and let `RequireAuth` decide.

**Transaction log**
- Tiny ring buffer in IndexedDB (`auth-tx-log`, last 20 entries) recording `{ op, phase, ts }`. On boot, if the last entry is `STARTED_*` without a matching `COMPLETE_*`, run the rollback for that op.

Files: `src/lib/cached-auth.ts`, `src/lib/offline-auth.ts`, `src/lib/offline-storage.ts` (new tx-log + atomic helpers), `src/main.tsx`, `src/components/Auth.tsx`, `src/components/auth/RequireAuth.tsx`.
Risk: Low. Adds layers; doesn't change the existing happy path.

---

### Phase 2 (P0) — Network Transition Hardening

Goal: going offline during a refresh, or coming back online with a stale offline session, never produces duplicate sessions or revoked tokens.

**Auth state machine**
- New `src/lib/auth-state-machine.ts` exposing explicit states: `BOOTING`, `ONLINE_AUTHENTICATED`, `OFFLINE_AUTHENTICATED`, `TRANSITIONING`, `UNAUTHENTICATED`. All auth code routes through `transition(from, to, reason)`; invalid transitions throw and are logged. Subscribers (RequireAuth, Auth, header) react to state, not to ad-hoc booleans.

**Mutex on auth ops**
- Wrap login / token-refresh / logout / offline-session-create in a single `authMutex` (reuse the `concurrency.ts` lock primitive). Concurrent calls await; second-presses of the sign-in button become no-ops with feedback.

**Network-aware queuing for refresh**
- If the Supabase client triggers a refresh while `navigator.onLine === false`, queue it in IndexedDB and replay on the next `online` event. Until then, the synthetic offline session continues serving `RequireAuth`.

**Idempotent online reconciliation**
- When transitioning `OFFLINE_AUTHENTICATED → ONLINE_AUTHENTICATED`, call a new `reconcileOfflineSession()` that exchanges the cached refresh token for a fresh online session in a single attempt. If the server says "reuse / revoked," fall back to forcing re-login but preserve the IndexedDB queue so unsynced reports survive.

Files: `src/lib/auth-state-machine.ts` (new), `src/lib/cached-auth.ts`, `src/lib/offline-auth.ts`, `src/lib/concurrency.ts`, `src/components/auth/RequireAuth.tsx`, `src/integrations/supabase/client.ts` (event hooks only — file is auto-generated, so we hook via `supabase.auth.onAuthStateChange` in a new `src/lib/auth-bridge.ts`).
Risk: Medium. State machine is the most invasive change; existing auth call sites need to migrate. Ship behind a feature flag (`localStorage.AUTH_FSM=1`) for one release before defaulting on.

---

### Phase 3 (P1) — Storage Pressure Safety

Goal: token writes never silently fail when the device is full.

**Pre-flight quota check**
- Extend `useStoragePressure.tsx` / `storage-pressure-manager.ts` with `ensureSpaceFor('auth')`. Auth gets a reserved 1 MB headroom. Before any auth write, call this; if insufficient, evict non-auth caches first (photos, autocomplete, profile cache).

**Quota-exception handling**
- Wrap every auth `setItem` / `put` in a try/catch that specifically detects `QuotaExceededError`. On hit: trigger eviction, retry once, then surface a non-blocking toast ("Device storage low — offline sign-in may be unreliable") via `mobile-toast-bridge.ts`.

**Auth-priority pinning**
- Update `storage-pressure-eviction` policy: auth keys (`offline-auth-*`, `auth-tx-log`, synthetic session) are never evictable. Document in the existing memory file.

Files: `src/lib/storage-pressure-manager.ts`, `src/hooks/useStoragePressure.tsx`, `src/lib/cached-auth.ts`, `src/lib/offline-auth.ts`.
Risk: Very low.

---

### Phase 4 (P1) — Token Theft Mitigation

Goal: a stolen device or extracted IndexedDB dump has a hard time impersonating the user, and the legitimate user can revoke remotely.

**Encrypt tokens at rest**
- Generate a non-extractable AES-GCM key via `crypto.subtle.generateKey({ extractable: false })` on first run; persist the `CryptoKey` handle in IndexedDB (the key material itself stays inside the browser's keystore). Encrypt the refresh token + email mapping before writing; decrypt on read. Keep a one-time migration that re-encrypts existing plaintext tokens on next boot.

**Bounded offline window**
- Add `offlineExpiresAt` (default 14 days, admin-tunable via `admin_settings`) to the synthetic session. After expiry, `RequireAuth` forces an online sign-in regardless of token validity. Show a soft warning at T-2 days.

**Device fingerprint binding (best-effort)**
- Compute a stable fingerprint hash (UA + screen + timezone + persistent random salt stored alongside the key) at first sign-in. Send it as a custom header on token-refresh requests via an edge function `auth-refresh-bound`. Server-side comparison is logged-only in v1 (warn on mismatch), enforcement flag flipped in v2 after we see false-positive rates.

**Remote revoke + anomaly detection**
- New `auth_sessions` table: `{ id, user_id, fingerprint_hash, last_seen_at, last_ip, revoked_at }`. Edge function `auth-list-sessions` + `auth-revoke-session` + a "Sign out all devices" button in `Profile.tsx`. Edge function `auth-record-refresh` increments `last_seen_at` and flags duplicate-fingerprint reuse → auto-revoke + push notification via existing `send-push-notification`.

Files: new `src/lib/auth-crypto.ts`; new edge functions `auth-list-sessions`, `auth-revoke-session`, `auth-record-refresh`; migration for `auth_sessions` + RLS; `src/pages/Profile.tsx`; `src/lib/cached-auth.ts`, `src/lib/offline-auth.ts`.
Risk: Medium-high. Encryption migration is the highest-risk piece — must run after Phase 1's atomic writes are in place so a half-migrated token can't brick offline auth. Fingerprint binding starts in log-only mode.

---

### Phase 5 (P2) — Schema Migration Safety

Goal: an offline user updating from an old build never gets stuck with unreadable session data.

**Versioned auth schema**
- Add `authSchemaVersion` next to the encrypted blob. `bootMigrateAuth()` runs on every start; switch on version and apply migrations sequentially. Each migration writes the new format to `.tmp`, verifies it, then swaps — old format kept until next successful boot.

**Migration rollback log**
- On migration failure, restore old format, append `{ from, to, error }` to the auth-recovery log, and queue a one-time "report this when online" telemetry event via existing `version-telemetry.ts`.

**PWA update coordination**
- In `usePWAUpdate.tsx`, gate `skipWaiting` on `auth-tx-log` being clean (no in-flight auth op). Prevents updating the SW mid-token-refresh.

Files: `src/lib/cached-auth.ts`, `src/lib/offline-auth.ts`, `src/lib/version-telemetry.ts`, `src/hooks/usePWAUpdate.tsx`.
Risk: Low.

---

### Out of Scope (intentionally deferred)

- **"Anyone can use the app fully signed-out, offline, with no prior account"** — not addressed here. The previous discussion confirmed this requires a separate product decision (public guest mode, baked-in service account, or read-only shareable URLs). This plan hardens the *existing* trust-then-verify model so that anyone who has *ever* signed in online stays functional offline through every failure mode above.

---

### Execution order

1. Phase 1 (atomic + redundant + boot validation) — foundation everything else depends on.
2. Phase 2 (state machine + mutex) — eliminates the race-condition class of bugs.
3. Phase 3 (storage pressure) — small, ship alongside Phase 2.
4. Phase 4 (encryption + remote revoke) — biggest user-visible security upgrade; needs Phases 1–2 landed first.
5. Phase 5 (migration safety) — ship before any future schema change.

Confirm which phase to start with (recommend Phase 1) and I'll switch to implementation.

