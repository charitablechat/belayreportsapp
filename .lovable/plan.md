

## Plan — C1: Photos `by-uploaded` index 0|1 contract enforcement

The previous `IDBKeyRange.only(0|1)` fix only patched the read side. Writers still persist boolean `uploaded`, so on spec-strict browsers (Safari) the index silently drops those rows. We finish the contract end-to-end.

### Changes

**1. `src/lib/offline-storage.ts` — write-side coercion + schema typing**

- Update the `OfflinePhoto` schema type so `uploaded` is `0 | 1` (the on-disk shape). Keep a separate input alias for callers that still pass `boolean`.
- Add a `toUploadedFlag(v: unknown): 0 | 1` helper. Truthy → 1, falsy → 0.
- Wrap `uploaded` at every write site:
  - `savePhotoOffline` (~line 1888): coerce `photo.uploaded` before `put`.
  - `markPhotoAsUploaded` (~line 2174): write `1`, not `true`.
  - Any photo-record `put`/`add` discovered in the file (incl. backup-restore + dead-letter requeue paths) gets the same coercion.
- Bump IDB schema version (next free version after current head) and add an `upgrade` step: open a cursor on `photos`, rewrite any `uploaded` that is `true`/`false` to `1`/`0`. Idempotent — values already `0|1` are skipped.
- Index declaration stays `'by-uploaded': number`; record type now matches.

**2. Regression test — `src/lib/__tests__/photos-by-uploaded-contract.test.ts`** (new)

Using fake-indexeddb (already wired in `src/test/setup.ts`):
- Round-trip: `savePhotoOffline({uploaded: false})` → `getUnuploadedPhotos()` returns the row.
- After `markPhotoAsUploaded`, `getUnuploadedPhotos()` excludes it and `IDBKeyRange.only(1)` includes it.
- Schema migration test: pre-seed a row with literal `uploaded: true` at the previous schema version, reopen at the new version, assert the row was rewritten to `1` and is queryable via `IDBKeyRange.only(1)`.
- Direct contract assertion: every row read from the store has `typeof uploaded === 'number'`.

**3. Memory update**

Refresh `mem://constraints/photos-uploaded-index` to reflect that the contract is now enforced at the write site + migration + test, not just the read site.

### Out of scope

- C2 (`getUnsyncedCounts` boundary parity) and C3 (drift race) — tracked separately.
- Photo backup-export ZIPs that may contain boolean `uploaded` in their JSON manifest — those are read-only artifacts, no on-disk index involved.

### Files touched

- `src/lib/offline-storage.ts` (type, helper, 2+ write-site coercions, schema bump + upgrade hook)
- `src/lib/__tests__/photos-by-uploaded-contract.test.ts` (new)
- `mem://constraints/photos-uploaded-index.md` (refresh)

