

## 1.A — Rewrite queued photo paths at offline-auth reconciliation

When a user creates photos offline under a deterministic UUID and later signs in online for the first time, `verifyAndReconcileOfflineAuth()` migrates parent report rows (`inspector_id`) but intentionally leaves `photoUrl` alone (see `migrateUserData` C7 comment). For **already-uploaded** photos that's correct — the storage object lives at the old prefix forever and signed URLs work regardless. But for **pending (not-yet-uploaded)** photos, the path still encodes the old uid, so the next `syncPhotos()` call POSTs to `<oldUid>/...` and hits a storage RLS denial because the authenticated user is now `<newUid>`.

### Change

In `src/lib/offline-auth.ts`:

1. **Add `migratePendingPhotoPaths(oldUserId, newUserId)`** — a private helper that:
   - Opens the `photos` store from `getDB()` (`./offline-storage`).
   - Reads all photos in a `readonly` tx, filters in memory to those that are **unsynced/pending** AND whose `photoUrl` starts with `${oldUserId}/`.
   - In a single `readwrite` tx, fires `put` for each rewritten record (`photoUrl = ${newUserId}/<rest>`), preserving every other field. Uses the same "fire all puts synchronously, await `Promise.all` + `tx.done`" pattern already used in `migrateUserData` so the tx doesn't auto-close.
   - Wraps each store access in try/catch so a single bad row doesn't abort the migration.
   - Logs `[OfflineAuth] Migrated N pending photo paths <old> → <new>` in dev.

2. **Pending detection** — match the project's existing semantics. Read `src/lib/offline-storage.ts` `Photo` shape to confirm the field name (likely `synced: false` / no `synced_at` / `uploaded: false`). Use whichever flag `syncPhotos` already treats as "needs upload" so we don't accidentally rewrite already-uploaded rows (those must keep the `<oldUid>/` path — their storage object is there, signed URLs depend on it; rewriting would 404 the gallery).

3. **Wire into the success branch of `verifyAndReconcileOfflineAuth`** — inside the existing `if (realUserId !== syntheticUserId)` block in `verifyAndReconcileOfflineAuth` (around lines 285-292), call `migratePendingPhotoPaths(syntheticUserId, realUserId)` immediately after `migrateUserData(...)` and before the `toast.success(...)`. This guarantees the rewrite happens **before** `useAutoSync` triggers the next `syncPhotos()` cycle (the hook only kicks sync after `verifyAndReconcileOfflineAuth` resolves).

4. **No change to `migrateUserData`'s C7 invariant** — uploaded photos are still untouched. Only the pending subset is rewritten. Update the C7 comment in `migrateUserData` to cross-reference the new helper so future readers understand the split.

### Files touched
- `src/lib/offline-auth.ts` — add helper + one call site + comment update.

No DB, no edge functions, no UI, no tests required (existing sync path will exercise it). No memory updates needed; behavior is internal to the existing offline-auth reconciliation memory.

