
## ✅ COMPLETED: Fix Deleted Child Rows Reappear After Sync

## Fix: Deleted Child Rows Reappear After Sync

### Root Cause

When a user deletes a row (e.g., an operating system, zipline, or equipment entry) from within a report form, the deletion is only applied locally. The server-side sync uses **upsert-only** logic and explicitly blocks DELETE operations on child tables via a safety blocklist. This means:

1. Local state (in-memory + IndexedDB) correctly removes the row
2. Server sync only UPSERTs remaining rows -- the deleted row stays on the server
3. On next session load, the server data (with the "deleted" row still present) gets fetched and merged back in
4. The deletion appears to "undo" itself

This is confirmed by the comment in `atomic-sync-manager.ts` line 445: *"NEVER delete -- preserves server rows not in local state"* and the `REPORT_TABLE_BLOCKLIST` in `transaction-manager.ts` which blocks all delete operations on report child tables.

### Solution: Server-Side Reconciliation via Delete-and-Replace

Instead of trying to track individual row deletions (which is fragile with offline/sync scenarios), the sync process will adopt a **delete-and-replace** pattern for child tables. Before upserting the current local data, the sync will delete all existing server rows for that report's child table, then insert the current set. This is wrapped in the existing transaction pattern so rollback is possible on failure.

This is safe because:
- The pre-sync version snapshot already captures an immutable backup before any sync
- The existing rollback mechanism can restore deleted rows on failure
- The `REPORT_TABLE_BLOCKLIST` guard will be updated to allow controlled deletes during sync (not ad-hoc deletes)

### Changes

#### 1. Database Migration: Add `deleted_items` tracking table

Create a new table `report_deleted_items` to log which child rows were intentionally deleted by users. This provides the audit trail and recovery capability requested.

```sql
CREATE TABLE public.report_deleted_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('inspection', 'training', 'daily_assessment')),
  report_id UUID NOT NULL,
  child_table TEXT NOT NULL,
  deleted_item_id UUID NOT NULL,
  deleted_item_data JSONB NOT NULL,
  deleted_by UUID REFERENCES auth.users(id),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  restored_by UUID REFERENCES auth.users(id)
);

-- RLS: owners can insert (log deletions), super admins can view/restore
ALTER TABLE public.report_deleted_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can log their own deletions"
  ON public.report_deleted_items FOR INSERT
  WITH CHECK (deleted_by = auth.uid());

CREATE POLICY "Super admins can view all deleted items"
  ON public.report_deleted_items FOR SELECT
  USING (public.is_super_admin());

CREATE POLICY "Users can view their own deleted items"
  ON public.report_deleted_items FOR SELECT
  USING (deleted_by = auth.uid());

CREATE POLICY "Super admins can restore deleted items"
  ON public.report_deleted_items FOR UPDATE
  USING (public.is_super_admin());

-- Index for efficient lookups
CREATE INDEX idx_deleted_items_report ON public.report_deleted_items(report_type, report_id);
CREATE INDEX idx_deleted_items_lookup ON public.report_deleted_items(child_table, deleted_item_id);
```

#### 2. Update `transaction-manager.ts`

Modify the `REPORT_TABLE_BLOCKLIST` to allow a new `'replace'` operation type (or add a bypass flag) so that the sync pipeline can perform controlled delete-then-insert for child tables. The blocklist should only prevent ad-hoc deletes, not reconciliation deletes during a full sync.

Add a new `TransactionStep` operation type `'replace'` that:
1. Fetches all existing rows for the child table (for rollback)
2. Deletes all rows matching the report ID
3. Inserts the current set of rows

#### 3. Update `atomic-sync-manager.ts` -- Inspection Sync

In `syncInspectionAtomic`, change child table sync from upsert-only to delete-and-replace:

- Before upserting systems/ziplines/equipment/standards/summary, first delete all existing rows for this inspection_id from each child table
- Log deleted item IDs to `report_deleted_items` for audit/recovery (comparing server rows vs local rows to identify which were intentionally removed)
- Upsert current local data

The same pattern applies to training and daily assessment sync functions.

#### 4. Update `atomic-sync-manager.ts` -- Training Sync

Apply the same delete-and-replace pattern for training child tables:
- `training_delivery_approaches`
- `training_operating_systems`
- `training_immediate_attention`
- `training_verifiable_items`
- `training_systems_in_place`
- `training_summary`

#### 5. Update `atomic-sync-manager.ts` -- Daily Assessment Sync

Apply the same delete-and-replace pattern for daily assessment child tables:
- `daily_assessment_beginning_of_day`
- `daily_assessment_end_of_day`
- `daily_assessment_operating_systems`
- `daily_assessment_equipment_checks`
- `daily_assessment_structure_checks`
- `daily_assessment_environment_checks`

#### 6. Update `InspectionForm.tsx` save logic

In the online save path (lines ~1380-1530), add server-side deletion of removed rows:
- Before upserting, fetch current server rows for each child table
- Compare server row IDs with local row IDs
- DELETE server rows that are no longer in the local set
- Log deleted rows to `report_deleted_items`

#### 7. Apply same save logic updates to `TrainingForm.tsx` and `DailyAssessmentForm.tsx`

Ensure the same reconciliation delete logic exists in the inline save paths for training and daily assessment forms.

### Safety Guarantees

| Concern | Mitigation |
|---------|-----------|
| Accidental data loss during sync | Pre-sync version snapshot already captures immutable backup |
| Rollback on sync failure | Transaction manager restores deleted rows from rollback data |
| Recovery of user-deleted items | `report_deleted_items` table logs all deletions with full item data (JSONB) |
| Offline scenario | Deletions persist in IndexedDB locally; reconciled on next online sync |
| Empty local guard bypass | The existing `empty_local_guard` still blocks if ALL local data is empty (corruption detection) |

### What is NOT Changing

- The soft-delete mechanism for entire reports (inspections/trainings/daily_assessments parent records) remains unchanged
- RLS policies on parent tables are untouched
- The version history / backup ledger systems remain unchanged
- Frontend delete confirmation dialogs and UX remain the same
- The `allowEmpty` guard in `saveRelatedDataOffline` remains for IndexedDB safety

