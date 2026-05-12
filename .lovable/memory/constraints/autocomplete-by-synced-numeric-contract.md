---
name: autocomplete-by-synced-numeric-contract
description: autocomplete_history.synced must be stored as 0|1 (not boolean); IDB silently drops booleans from the by-synced index
type: constraint
---

L-3 (audit). Same C1 contract as `photos.by-uploaded` — IndexedDB silently
drops boolean values from indexes, so before this fix
`getUnsyncedAutocompleteEntries()` always returned `[]` even when callers
had pushed `synced: false` rows.

Enforcement:
- `toAutocompleteSyncedFlag(v): 0|1` (src/lib/offline-storage.ts) coerces
  at the write boundary inside `putAutocompleteEntry` and
  `bulkPutAutocompleteEntries`.
- `getUnsyncedAutocompleteEntries` queries `IDBKeyRange.only(0)` and maps
  results back to `synced: false` so the public `AutocompleteEntry` type
  stays boolean for callers.
- v19 migration cursor coerces legacy boolean rows to `0|1` (idempotent).
- DB version bumped to 19 in BOTH `public/db-config.js` and
  `src/lib/offline-storage.ts`; `vite-db-version-check.ts` enforces parity.
- Regression-locked by `src/lib/__tests__/autocomplete-by-synced-contract.test.ts`.

Never re-introduce a `db.put('autocomplete_history', entry)` that bypasses
the coercion helper.
