

## Snapshot Restoration: Merge Bug in Server-Side Restore Paths

### Problem Found

**IndexedDB restore** (local): All save functions (`saveRelatedDataOffline`, `saveTrainingDataOffline`, `saveAssessmentDataOffline`) perform **delete-all-then-put** within a single transaction — this is a **full replacement**. Correct.

**Server-side restore** (2 functions): Both use `upsert()` only, which **updates existing rows and inserts new ones but never deletes rows that are absent from the snapshot**.

```text
Example failure:
  Current DB:    [System A, System B, System C, System D, System E]
  Snapshot data: [System A, System B, System C]
  After upsert:  [System A*, System B*, System C*, System D, System E]  ← D & E are orphans
```

### Affected Functions

| Function | File | Issue |
|----------|------|-------|
| `restoreSnapshotToServer` | `src/lib/cloud-backup.ts` | Upserts children without deleting current rows first |
| `restoreAdminEditSnapshot` | `src/lib/admin-edit-snapshot.ts` | Same — upserts children without deleting current rows first |

### Fix

For both functions, before upserting children for each child table, **delete all existing child rows** for that report ID, then insert the snapshot rows. This converts the operation from merge to full replacement.

**`src/lib/cloud-backup.ts` — `restoreSnapshotToServer`:**
- Determine the FK column name based on `reportType` (e.g., `inspection_id`, `training_id`, `assessment_id`)
- Before the child upsert loop, for each child table: run `.delete().eq(fkColumn, reportId)` then `.insert(rows)`

**`src/lib/admin-edit-snapshot.ts` — `restoreAdminEditSnapshot`:**
- Same pattern: delete existing children by FK before inserting snapshot children
- Already has `PARENT_FK` and `CHILD_TABLES` maps that provide the FK column name

Both changes are ~5 lines each — add a delete call before the insert/upsert in the child loop.

### What Stays Correct (No Changes Needed)

- **IndexedDB paths** (import, version restore): Already do full replacement via delete-then-put
- **`report-data-imported` event handler**: Reloads from IndexedDB which has the replaced data — correct
- **Parent record upsert**: Single row by ID — upsert is equivalent to replace — correct

