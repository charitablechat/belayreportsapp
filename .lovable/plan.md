

## Gap 2.3 — Quota-aware localStorage writes across the codebase

### Problem

Multiple direct `localStorage.setItem` call sites have no `QuotaExceededError` handling. When storage fills up:

- `local-backup-ledger.ts:147` (`saveReportSnapshot`) — wrapped in a generic `try/catch` that prints `console.warn('Failed to save snapshot')` and exits. The user-facing IDB save proceeds and the form thinks everything is fine, but the backup ledger row was silently dropped.
- `local-backup-ledger.ts:284` (`markSnapshotSynced`) — outer `try/catch` swallows everything; if the rewrite fails, the snapshot stays flagged unsynced forever.
- `offline-auth.ts` and other auth/admin writers — silent quota failures here can corrupt offline-auth state without any signal.
- `useAutoSync.tsx` and other hooks — minor flag writes that set a project-wide precedent that quota is ignored.

There is also no central place to apply Phase 3's eviction/headroom logic before non-auth writes.

### Solution: a single `safeSetItem` helper + audited adoption

Add one tiny utility, then route quota-sensitive writers through it. Don't try to refactor every `localStorage.setItem` in the codebase — only the ones where silent failure costs data or stalls a workflow.

#### 1. New helper `src/lib/safe-local-storage.ts`

A small module with a single primary function `safeSetItem`:

```ts
export type SafeSetItemResult =
  | { ok: true }
  | { ok: false; code: 'quota' | 'blocked' | 'unknown'; error: unknown };

export function safeSetItem(
  key: string,
  value: string,
  opts?: {
    scope?: string;       // for log-error routing
    critical?: boolean;   // true → also surface to notification center
    onFail?: (code, error) => void; // optional caller hook (e.g. retry, evict)
  }
): SafeSetItemResult;
```

Behavior:
- Try `localStorage.setItem(key, value)`.
- On success: return `{ ok: true }`.
- On error: classify (`QuotaExceededError`/code 22/1014 → `'quota'`, `SecurityError` → `'blocked'`, else `'unknown'`).
- Always `console.error('[safeSetItem] FAILED', { key, scope, code, bytes, error })` — operational signal, never gated.
- Forward to `logError` (existing `src/lib/log-error.ts`) with `scope`, `key`, `code`, `approxBytes` so admins see it in `audit_logs.client.error`. Best-effort dynamic import; never throws.
- If `opts.critical === true`, fire-and-forget `addSyncNotification('Storage is full — {scope} could not be saved.')` via the notification-center dynamic import.
- Call `opts.onFail?.(code, error)` so callers can attempt their own recovery (e.g. `local-backup-ledger` evict + retry, see step 2).
- Return `{ ok: false, code, error }`.

Also export a thin `safeRemoveItem(key)` (for symmetry; never throws) — useful in dead-letter cleanups but optional adoption.

**Out of scope:** no eviction logic inside `safeSetItem` itself. Callers know best what to evict (e.g. backup ledger evicts old synced snapshots; auth writes are pinned and must not evict).

#### 2. Adopt in `src/lib/local-backup-ledger.ts`

Two call sites:

a) **`saveReportSnapshot` (~line 147)** — replace the bare `localStorage.setItem(key, json)` with `safeSetItem(key, json, { scope: 'backup-ledger.save', critical: !isSynced, onFail })`. The `onFail` for `'quota'` should:
  - Call the existing `evictIfNeeded(estimatedBytes * 2)` with a doubled budget,
  - Retry `safeSetItem` once; if still failing, give up and rely on the logged error + notification.

This means the eviction LRU runs more aggressively under pressure, but **never evicts unsynced snapshots** (already enforced inside `evictIfNeeded`). The cloud-backup fire-and-forget continues unchanged so the row at least lives off-device.

b) **`markSnapshotSynced` (~line 284)** — replace the inner `localStorage.setItem(key, JSON.stringify(snapshot))` with `safeSetItem(...)`, scope `'backup-ledger.markSynced'`, `critical: false` (this is a status update, not data loss). On failure just log; the snapshot is still in localStorage with its old `synced=false` flag and will be retried at the next sync completion.

c) Bonus tightening: invalidate the cached `_cachedStorageBytes` (`_storageBytesTs = 0`) on a successful set so eviction decisions stay accurate after writes.

#### 3. Adopt in `src/lib/offline-auth.ts`

Audit `localStorage.setItem` calls there. For each one:

- **Cached profile / admin-status writes** (e.g. `cached-admin-status`, `cached_profile`): route through `safeSetItem` with `scope: 'offline-auth.cached-profile'`, `critical: false`. These regenerate on next online sign-in, so a logged warning is the right surface.
- **Offline-auth credential slot writes** (the `offline_auth_*` / `offline_auth_backup_*` keys written by `auth-resilience.ts`, if any are still done directly here rather than via `auth-resilience`): leave alone — Phase 1/3 already handle these via `auth-resilience.ts` with `ensureSpaceForAuth` pre-flight + retry-with-eviction (`mem://auth/phase3-storage-pressure`). Do **not** wrap them in `safeSetItem` as well; doing so could re-trigger eviction loops and conflict with auth-key pinning.

I will grep for `localStorage.setItem(` in `src/lib/offline-auth.ts` during implementation and only swap the non-auth-credential sites.

#### 4. Adopt in `src/hooks/useAutoSync.tsx` (and a handful of similar flag-style writers)

The `storage-eviction-warned` and similar UI-only flags are minor, but the precedent matters. Convert them to `safeSetItem(..., { scope: 'auto-sync.flag', critical: false })`. On `'quota'` we silently ignore — these flags' only job is debouncing notifications, so losing them just means an extra notification, not data loss.

If similar one-line writers exist nearby (e.g. `useReportSync.tsx`, `useStoragePressure.tsx`), apply the same swap as part of the same edit pass. **Do not** sweep every file in the project — that's out of scope for this gap. Pure-debounce flag writes are the only "courtesy" adoption; everything else is opt-in per the call-site's data-loss profile.

#### 5. Tests

Add `src/lib/__tests__/safe-local-storage.test.ts`:
- Returns `{ ok: true }` on normal write.
- Returns `{ ok: false, code: 'quota' }` when `setItem` throws a `QuotaExceededError`.
- Returns `{ ok: false, code: 'blocked' }` on `SecurityError`.
- Calls the `onFail` hook with the right code.
- Never throws synchronously, even if dynamic imports inside (`logError`, `notification-center`) fail.

A small additional test in the existing `offline-storage-save-boundary.test.ts` would be nice but is not required — the new helper is independent of the IDB save boundary.

### Out of scope

- No project-wide sweep of every `localStorage.setItem` site. Only the data-integrity / workflow-stalling ones listed above. Future call sites should use `safeSetItem` by default; documenting that convention is part of this commit but enforcing it across legacy code is a follow-up.
- No changes to `auth-resilience.ts` writes — those already have Phase 3 quota handling; doubling up would conflict with pinning.
- No new UI. `addSyncNotification` already surfaces critical failures into the existing notification rail.
- No DB / edge-function / migration changes.

### Files touched

1. `src/lib/safe-local-storage.ts` — new helper (~70 lines).
2. `src/lib/local-backup-ledger.ts` — wrap two `setItem` sites; add evict-and-retry on quota in `saveReportSnapshot`; invalidate `_cachedStorageBytes` on success.
3. `src/lib/offline-auth.ts` — wrap non-auth-credential `setItem` sites only.
4. `src/hooks/useAutoSync.tsx` — wrap flag writes.
5. `src/lib/__tests__/safe-local-storage.test.ts` — new tests.

