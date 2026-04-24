---
name: sync-boundary-test-coverage
description: H6 — fake-indexeddb tests cover getUnsynced* drift, dirty flag, quarantine, and the photos.by-uploaded 0|1 index contract
type: feature
---

H6 fix. `src/test/setup.ts` now imports `fake-indexeddb/auto` so every test gets a real (in-memory) IndexedDB. New file `src/lib/__tests__/unsynced-read-boundary.test.ts` exercises the highest-risk read paths against the real schema (v17 migration runs per test):

- 29s drift → record treated as synced (within `SYNC_DRIFT_TOLERANCE_MS = 30_000`).
- 31s drift → flagged unsynced.
- `dirty=true` overrides drift even when `synced_at == updated_at` (C3 contract).
- `_remote_deleted_at` quarantined rows are excluded from the unsynced set (C9).
- Empty store returns `[]`, NOT `IdbReadFailure` (regression guard for the boundary helper).
- Temp-id orphans owned by another user still surface for cross-user recovery.
- `saveInspectionOffline` always stamps `dirty=true` so the next `getUnsynced*` call sees the edit.
- `photos.by-uploaded` index lookup with key `0` works (C1 contract — IDB cannot index booleans).

Per-test reset uses `new IDBFactory()` + `vi.resetModules()` so the cached `dbPromise` inside offline-storage doesn't leak across tests. Use `getDB()` (the exported singleton getter) when a test needs to mutate the live record directly — never `openDB()` without the schema, that yields a stub v1 DB without object stores.
