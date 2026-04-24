

## C1 — IDBKeyRange.only photos.by-uploaded contract — status check

All four sub-points from the verdict are already resolved in the codebase. No changes needed.

### Sub-point 1 — "backing data still written as boolean"
**Resolved.** `savePhotoOffline` (line 2163) and `markPhotoAsUploaded` (line 2450) both funnel through `toUploadedFlag(...)` (lines 2129-2131), which coerces every shape to `0 | 1`. Grep for `uploaded:\s*(true|false|boolean)` in `offline-storage.ts` returns zero matches.

### Sub-point 2 — "no IDB schema migration to convert legacy boolean values"
**Resolved.** Two migrations exist:
- **v16** (lines 1559-1585) — first attempt, rewrites legacy boolean `uploaded` → `0|1`.
- **v18** (lines 1634+) — re-runs the coercion using the wrapped `IDBPObjectStore` because v16 used raw IDB cursors that didn't keep the upgrade transaction alive long enough on slow devices. Idempotent and safe to re-run.

`DB_VERSION = 18` in `offline-storage.ts`, matched by `version: 18` in `public/db-config.js`. The build-time `viteDbVersionCheck` plugin enforces parity.

### Sub-point 3 — "index type contradicts record type"
**Resolved.** Schema declaration at line 64:
```ts
indexes: { 'by-inspection': string; 'by-uploaded': number };
```
The `uploaded` field on the record is now typed as `0 | 1` and every write path goes through `toUploadedFlag` which returns `0 | 1`. TypeScript would now catch a regression at the write site.

### Sub-point 4 — "no regression test against the by-uploaded key-type contract"
**Resolved.** Two test files lock the contract against a real `fake-indexeddb`:
- `src/lib/__tests__/photos-by-uploaded-contract.test.ts` — five-case suite covering: write-site coercion, `IDBKeyRange.only(0)` vs `only(1)` round-trip, `markPhotoAsUploaded` bucket transition, `toUploadedFlag` shape coverage, and v15→v16 schema migration of legacy boolean rows.
- `src/lib/__tests__/photo-uploaded-index.test.ts` — companion regression test confirming `getUnuploadedPhotos` actually returns rows written via the public API.

Plus a memory entry: `mem://constraints/photos-uploaded-index`.

### Verdict

C1 is fully shipped — write-site coercion, double schema migration (v16 + v18 belt-and-braces), schema typing, and contract tests. Nothing to plan.

