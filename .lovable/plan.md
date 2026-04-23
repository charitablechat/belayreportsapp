

## 1.D — One-time storage RLS probe at boot

A 1-byte probe upload + immediate delete to `${user.id}/__probe/${Date.now()}.bin` confirms the photo-upload path is RLS-healthy for the current user before they capture anything that could be lost.

### Design decisions

**Where it runs.** A new tiny module `src/lib/storage-rls-probe.ts` exposes `runStorageRlsProbeOnce()`. Invoked from `src/main.tsx` after `initAuthBridge()` in a non-blocking `Promise.resolve().then(...)` so React mount is never delayed.

**Single-shot semantics.**
- Per-session guard: a module-level `let didRun = false` prevents re-entry within a tab.
- Per-user persistence: `localStorage` key `storage-rls-probe:<userId>:<YYYY-MM-DD>` so we run it at most once per user per UTC day. If RLS drift happens later that day we'll still catch it on next day's boot or on demand. No state stored when offline.

**Preconditions (cheap, fast bailouts).**
- `navigator.onLine` true.
- `getUserWithCache()` returns a user (avoids calling `supabase.auth.getUser()` again — the cached helper is already used everywhere).
- Not in preview/iframe environment (`isPreviewOrIframeEnvironment()`) — we don't want noisy probes in Lovable preview where storage policies may differ.
- `localStorage` flag for today's user not set.

**The probe itself.**
- Bucket: `'inspection-photos'` (the bucket already used by `sync-manager.ts` for photo uploads — this is what we actually need to verify, not other buckets).
- Path: `${user.id}/__probe/${Date.now()}.bin`.
- Body: `new Blob([new Uint8Array([0])], { type: 'application/octet-stream' })`.
- Upload with `upsert: false` (matches sync-manager's M7 invariant).
- Immediately `remove([fileName])` regardless of upload outcome (so partial successes don't leave litter).
- Wrap in `try/catch`. Both success and storage-not-allowed counts as "ran"; only network/transient errors should leave the flag unset so we retry tomorrow.

**Failure surface.**
- On RLS denial (status 403 / message contains "row-level security" / "policy") OR any non-transient error:
  - `logError(err, { scope: 'storage-rls-probe', userId: user.id, extra: { code, status } })` — already-existing centralized logger writes to `audit_logs.client.error`.
  - `addSyncNotification('Storage upload check failed — new photos may not save. Open Sync Diagnostics.')` — same notification rail used by 1.C, so it appears next to the dead-letter UI without new plumbing.
  - `console.error('[StorageRlsProbe] FAILED', ...)` — always logged (not gated by debug flag).
  - **Do not** show a toast — the user might not be in front of the screen at boot. The notification center + audit log are the right surfaces.
- On success: `console.log` only in dev; set the daily flag.

**No UI work.** Existing notification center + SyncDiagnosticsSheet already render the message; nothing new to wire.

**Cleanup.** The probe file is deleted in a `finally` block. If the delete itself fails (rare), it is logged but does NOT count as a probe failure — the user's photos are still safe; only a tiny stray object remains. A future bucket retention job (already in scope per `cleanup_expired_deleted_records`) is unaffected because the probe path doesn't touch DB rows. We accept up to 1 byte of orphan per failed-delete day.

**Concurrency / abort.**
- Use a 10s timeout via `AbortController` so a hung network never blocks anything else. If the abort fires, treat as transient (no flag set, no notification).

### Files touched
1. **`src/lib/storage-rls-probe.ts`** — new file, ~80 lines.
2. **`src/main.tsx`** — one new line that fires-and-forgets `runStorageRlsProbeOnce()` after `initAuthBridge()`.

No DB changes, no edge function, no migrations, no UI components, no dependency changes, no memory updates needed (the existing `mem://constraints/post-migration-storage-orphans.md` still describes the broader constraint; this probe is a verification, not a constraint).

