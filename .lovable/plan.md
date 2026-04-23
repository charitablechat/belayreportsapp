

## S29 — Replace heuristic `resolveTable` with explicit per-queue table binding

### Problem

`resolveTable(data)` in `src/lib/queued-soft-delete-processor.ts` (L36–42) infers the target Supabase table from the *shape* of the queued payload (`assessment_date`, `start_date`, `inspection_date`, `location`). A future column rename or a payload that happens to omit those fields would silently misroute a soft-delete to the wrong table — succeeding against the wrong row or failing without a clear cause.

It's also unnecessary: each of the three queue stores (`operations`, `assessment_operations`, `training_operations`) corresponds 1:1 to a single target table. The queue store itself is already the source of truth.

### Design

**Bind table at the queue level, not the payload level.**

In `src/lib/queued-soft-delete-processor.ts`:

1. **Delete `resolveTable`** entirely. Remove the heuristic and the `inspection_date|location` fallback.
2. **Hardcode the table name in each of the three loops** (they already iterate distinct stores):
   - `operations` queue → `'inspections'`
   - `assessment_operations` queue → `'daily_assessments'` (already hardcoded; no change)
   - `training_operations` queue → `'trainings'` (already hardcoded; no change)
3. **Add a defensive payload guard** in the inspections loop: if `op.data` is missing required identifiers (`id` / `deleted_at`), log a structured warn and skip (do not dead-letter — the op is malformed, not a server failure). This replaces the implicit "guess by shape" safety net with an explicit one.
4. **Tighten the `TableName` type usage**: keep the existing `type TableName = 'inspections' | 'trainings' | 'daily_assessments'` and pass the literal at the call site so TypeScript catches any future drift.

### Files

- **`src/lib/queued-soft-delete-processor.ts`**
  - Remove `resolveTable` function (L36–42).
  - In the inspections loop (around L137–142), replace `const table = resolveTable(op.data); if (!table) continue;` with `const table: TableName = 'inspections';` plus the malformed-payload guard.
  - No changes needed to assessments/trainings loops (already hardcoded).

### Out of scope

- Adding queue-store metadata to ops (not needed; the iterating store IS the binding).
- Migrating already-queued ops (no schema or shape change to existing payloads).
- Renaming `operations` → `inspection_operations` for symmetry with the other two stores (separate cleanup if desired; would require IDB version bump).

### Risk

Negligible. The change removes a code path that today only ever returns `'inspections'` (because it's only invoked from the inspections queue). No behavior change for any well-formed op; malformed ops now produce a clear warn instead of being routed to `'inspections'` by the catch-all `return 'inspections'` on L41.

### Verification

- `npx tsc --noEmit`.
- Manual: queue a soft-delete on each report type (inspection, training, assessment), go offline → online, confirm each lands on the correct table (verify via `select id, deleted_at from <table> where id = …`).
- Regression: confirm `getPendingSoftDeleteCount` still returns the same value before/after (it doesn't call `resolveTable`).

