

## S26 — Already implemented ✅

This task was completed in the prior combined S25+S26 turn. Current state in `src/lib/sync-reconciliation.ts` (L185–L235):

- `Promise.allSettled` replaces `Promise.all` so one thrown table never cancels its siblings.
- Each rejection is logged via `console.error('[Reconcile] Table <x> threw:', reason)` and synthesized into a `{ deletedCount: 0, blocked: true, blockReason: 'reconcile_threw: <msg>' }` pseudo-result.
- Failures flow into `blockedTables`, which makes `ReconcileAllResult.blocked === true`.
- The caller in `src/lib/atomic-sync-manager.ts` (L620 region) already aborts the parent sync without advancing `synced_at` whenever `blocked === true`, so partial child-table failures correctly trigger a retry on the next cycle.

### No changes needed

The behavior you described (one table fails → others delete → parent sync keeps going) is already prevented. If you'd like an additional safeguard — for example, **rolling back the successful sibling deletes** when one table fails — that would be a new task (S27) since reconcile deletes are currently not transactional across tables. Let me know if you want a plan for that.

