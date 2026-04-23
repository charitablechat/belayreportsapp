

## Tag remaining IDB operations with `withIDBTimeout` tiers

### What

Replace ad-hoc `Promise.race` / raw `setTimeout` patterns in `src/lib/offline-storage.ts` with `withIDBTimeout`, using the right tier per operation weight.

### Tier mapping

| Operation pattern | Tier |
|---|---|
| Single record lookup (`getInspection`, `getTraining`, `getAssessment`, `getPhoto`, single `.get(id)`) | `light` |
| Save / delete child arrays, batched puts, batched deletes | `write` |
| `getUnsyncedX` across stores, `getAllUnsynced*`, full-table scans, multi-store reads | `heavy` |
| Single flag/count read (`getMeta`, count queries, single key from kv store) | `light` |

### Approach

1. **Audit pass:** grep `src/lib/offline-storage.ts` for:
   - `Promise.race(`
   - `setTimeout(` (excluding the one inside `withIDBTimeout` itself)
   - `READ_TIMEOUT_MS`, `OPERATION_TIMEOUT`, any inline `ms` constants
   - bare `await tx.done` / `await store.get/getAll/put/delete` in exported helpers that don't already go through `withIndexedDBErrorBoundary`

2. **Classify each call site** into one of the four tiers above.

3. **Wrap each** with `withIDBTimeout(name, tier, fn, fallback)`:
   - `name`: short, includes key (e.g. `getInspection(${id})`, `saveRelatedData(${type}/${inspectionId})`).
   - `fallback`: matches the function's documented empty/null return (`null`, `[]`, `0`, `false`).
   - Discard `timedOut` for non-status helpers (only the three `*WithStatus` helpers care).

4. **Remove** the now-redundant local `Promise.race` + timeout constant blocks.

5. **Leave `withIndexedDBErrorBoundary` alone** — it stays the outer error wrapper. Inner `withIDBTimeout` provides the per-call tier-aware deadline. (Where a function already uses `withIndexedDBErrorBoundary` AND has its own race, drop the race; the boundary's tier-aware timeout from the previous turn is sufficient. Only add `withIDBTimeout` where there is currently a raw `Promise.race` or no timeout.)

### Out of scope

- Not touching `batch-storage.ts`, `auth-resilience.ts`, or other IDB modules — separate PRs.
- Not changing `withIDBTimeout`'s shape to expose `errored` separately from `timedOut`.
- Not retro-fitting consumers; existing return contracts are preserved.

### Risk

Low. `withIDBTimeout` already swallows errors into the fallback (matching prior `Promise.race` behavior), and tier ceilings (5–15s) are at or above the previous flat 5s, so legitimate slow operations get more headroom, not less.

