

## S27 — Harden conflict-audit insert against null `organization_id`

### Current state

`src/lib/atomic-sync-manager.ts` L420–434 already guards the `sync_conflicts` insert:

```ts
const organizationId = inspection.organization_id;
if (organizationId) {
  try { await supabase.from('sync_conflicts').insert({ ... }); }
  catch (auditErr) { console.warn(...); }
}
```

So the literal "throws and infinite-retries" scenario described in S27 cannot occur from this site today: the `if` skips the insert and the surrounding try/catch would swallow it anyway. DB confirms `sync_conflicts.organization_id` is `NOT NULL`, and exactly **1** inspection in production currently has `organization_id IS NULL`.

### What's still worth doing

Two small hardenings so the silent-skip path is observable and self-healing:

1. **Backfill attempt before skipping.** When `inspection.organization_id` is null but `inspection.organization` (text) is set, try a one-shot lookup against `organizations` by name and use that id for the audit insert. Don't mutate the inspection row — just enable the audit row. If lookup fails, fall through to the skip.

2. **Structured skip log + dev counter.** Replace the silent skip with a `console.warn('[Atomic Sync] sync_conflicts audit skipped: missing organization_id', { inspectionId })` so admins can spot orphaned records via diagnostics. Optional: bump a counter in `notification-center` if we want to surface it in the diagnostics sheet, but a console warn is enough for now.

### Files

- **`src/lib/atomic-sync-manager.ts`** (around L420–434):
  - Extract a tiny local helper `resolveOrgIdForAudit(inspection): Promise<string | null>` that returns `inspection.organization_id ?? lookupByName(inspection.organization)`.
  - Replace the inline `if (organizationId)` with `const organizationId = await resolveOrgIdForAudit(inspection);` then keep the existing guard + try/catch. On null, `console.warn` once with the inspection id.

### Out of scope

- Backfilling `inspections.organization_id` for the 1 legacy row — separate data task if desired.
- Making `sync_conflicts.organization_id` nullable — schema is intentionally strict.
- Adding analogous audit inserts for trainings / daily assessments (no `sync_conflicts` writes exist on those paths today).

### Risk

Negligible. The new lookup is a single indexed `select … where lower(name) = lower($1) limit 1`; failure mode is identical to today (skip the audit row).

### Verification

- `npx tsc --noEmit`.
- Manual: trigger a merge on the 1 null-org inspection; confirm console shows the structured warn (and, if the org name matches, that the audit row lands with the resolved id).

