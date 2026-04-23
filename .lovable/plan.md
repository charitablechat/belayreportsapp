

## S25 — Skip rollback pre-fetch when server row is unchanged since our last sync
## S26 — Isolate per-table failures in `reconcileAllChildTables`

### S25 — Design

**Trigger condition.** In each of the three `Promise.all([fetchRollbackData(...)])` blocks (inspections L521, trainings L1377, daily assessments L2168), the pre-fetch is only needed when server-side data may have changed. When `recordStatus.updated_at === inspection.synced_at` (or the equivalent training/assessment field), the server row is at exactly our last-known baseline — we already reconciled and upserted this state. Re-fetching 5–6 child tables costs real latency on mobile and nibbles the 25s `ITEM_SYNC_TIMEOUT` budget.

**Approach.** Introduce a local boolean near each prefetch site:

```ts
const serverUnchangedSinceBaseline =
  !!inspection.synced_at &&
  !!recordStatus?.updated_at &&
  recordStatus.updated_at === inspection.synced_at;
```

If `serverUnchangedSinceBaseline === true`, skip the `fetchRollbackData` calls and set the six `existingX` arrays to `[]`. Wire the downstream consumers:

1. **`reconcileAllChildTables` prefetched rows.** Pass `prefetchedServerRows: undefined` (not `[]`) for each table so `reconcileChildTable` falls back to its own single-table fetch **only if** it actually needs to compute a delete. That preserves safety: when locally-empty-but-server-had-rows, the existing Guard A/B inside `reconcileChildTable` still kicks in off the live fetch.
2. **Transaction rollbackData.** The upserted child rows currently stash `existingX` as `rollbackData` so a failed transaction can restore the pre-image. When we skip the prefetch, rollback loses the pre-image for those rows. Mitigation: set `rollbackData: undefined` and rely on Supabase's upsert semantics + the synced_at-gated final step — if the inspections-row update fails, the child-row upserts are benign (same IDs), and the record's `synced_at` won't advance, so the next cycle re-syncs. Document this explicitly with a comment.
3. **Empty-local-guard path (L529).** This guard only matters when server *has* child data. If server is unchanged from our baseline and our baseline already survived this guard once, there's no new suspicious-empty state to detect. Safe to skip.

**Scope.** Apply identically in all three code paths — inspection (≈L514–L527), training (≈L1370–L1384), daily assessment (≈L2160–L2176). Keep a single shared comment explaining the optimization so future readers see why it's safe.

### S26 — Design

Replace `Promise.all` with `Promise.allSettled` in `src/lib/sync-reconciliation.ts` (L185–L199). Each settled result falls into one of:

- `fulfilled` → use `.value.result` as today.
- `rejected` → synthesize a pseudo-result `{ deletedCount: 0, blocked: true, blockReason: 'reconcile_threw' }` and attach the error message to `blockedTables`.

The existing `ReconcileAllResult.blocked` + `blockedTables` contract already causes the caller (`atomic-sync-manager.ts` L620) to abort the parent sync without marking `synced_at`. Surfacing rejections as `blocked=true` plugs them into the same retry path — no caller changes needed.

Also add a `console.error('[Reconcile] Table <x> threw:', reason)` per rejection so the dead-letter surface is visible.

### Files

- `src/lib/atomic-sync-manager.ts` — three prefetch blocks get the `serverUnchangedSinceBaseline` short-circuit; thread `undefined` (not `[]`) into `reconcileAllChildTables` and transaction steps' `rollbackData` when skipping.
- `src/lib/sync-reconciliation.ts` — `reconcileAllChildTables` uses `Promise.allSettled` and maps rejections into `blockedTables`.

### Out of scope

- Changing `reconcileChildTable`'s own fetch-if-missing fallback (already handles `prefetchedServerRows === undefined`).
- Revising `fetchRollbackData` itself.
- Adjusting the `ITEM_SYNC_TIMEOUT` budget.

### Risk

Low.
- S25: If `serverUnchangedSinceBaseline` is ever a false positive (timestamp equality but server actually drifted), `reconcileChildTable` still performs its own fetch and guards, and the upsert path is idempotent. Worst case: rollbackData is missing for a failed mid-transaction step → final step (`synced_at` update) simply doesn't advance, next cycle replays.
- S26: `allSettled` can't regress — rejections previously took down the whole batch; now they're treated as blocked and retried.

### Verification

- `npx tsc --noEmit`.
- Manual smoke: sync an unchanged inspection twice; confirm second cycle shows no `fetchRollbackData` network calls (Network tab filter `inspection_systems`).
- Fault injection (dev-only): throw from `reconcileChildTable` for one table; confirm parent sync aborts with `reconcile_blocked` and the other four tables' reconcile logs still show their results.

