
# Fix: Equipment Data Loss Caused by Missing RLS Policies

## Root Cause (Confirmed via Network Logs)

The equipment save is returning **HTTP 403 Forbidden** from the database. This is NOT a state management or stale closure issue -- it is an **RLS (Row Level Security) policy gap**.

### The Evidence
Network request captured from the user's browser:
```
POST /rest/v1/inspection_equipment?on_conflict=id → 403 Forbidden
```

### Why It Happens

The logged-in user (Kale Dabling, `759e973e-...`) is a **super admin** but is NOT the inspector/owner of the Twin Cedars report (owned by `62ef2a7b-...`).

The `inspection_equipment` table has these RLS policies for super admins:
- SELECT -- can view (works)
- UPDATE -- can update (works)
- **INSERT -- MISSING**
- **DELETE -- MISSING**

The save code uses PostgREST **upsert** (`INSERT ... ON CONFLICT ... DO UPDATE`), which requires **INSERT** permission even when updating existing rows. Since INSERT is denied, the entire upsert fails with 403.

This same gap exists on ALL FIVE child tables:
- `inspection_equipment` (the reported issue)
- `inspection_systems`
- `inspection_ziplines`
- `inspection_standards`
- `inspection_summary`

### Why It Appears to "Save" But Then Data Disappears

1. User edits equipment quantity
2. `performSave` writes to IndexedDB (succeeds) AND updates the `inspections` table's `updated_at` (succeeds -- super admins have full CRUD on `inspections`)
3. Equipment upsert fails with 403 (server equipment NOT updated)
4. Error handler shows "Saved locally -- will sync when online" (misleading)
5. User navigates away and returns
6. Form loads: local inspection `updated_at` = server `updated_at` (both were updated in step 2)
7. `isLocalDataNewer` returns `false` (timestamps are equal, not local-is-newer)
8. Server equipment (without edits) overwrites local equipment -- data lost

## Fix: Add Missing RLS Policies

Add INSERT and DELETE policies for super admins on all 5 inspection child tables.

### Database Migration

```sql
-- inspection_equipment
CREATE POLICY "Super admins can insert inspection equipment"
  ON public.inspection_equipment FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection equipment"
  ON public.inspection_equipment FOR DELETE
  TO public USING (is_super_admin());

-- inspection_systems
CREATE POLICY "Super admins can insert inspection systems"
  ON public.inspection_systems FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection systems"
  ON public.inspection_systems FOR DELETE
  TO public USING (is_super_admin());

-- inspection_ziplines
CREATE POLICY "Super admins can insert inspection ziplines"
  ON public.inspection_ziplines FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection ziplines"
  ON public.inspection_ziplines FOR DELETE
  TO public USING (is_super_admin());

-- inspection_standards
CREATE POLICY "Super admins can insert inspection standards"
  ON public.inspection_standards FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection standards"
  ON public.inspection_standards FOR DELETE
  TO public USING (is_super_admin());

-- inspection_summary
CREATE POLICY "Super admins can insert inspection summaries"
  ON public.inspection_summary FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection summaries"
  ON public.inspection_summary FOR DELETE
  TO public USING (is_super_admin());
```

## No Code Changes Required

This is purely a database policy issue. No changes to `InspectionForm.tsx`, `EquipmentTable.tsx`, or any other source file are needed.

## Impact

| Scenario | Before | After |
|----------|--------|-------|
| Super admin edits equipment on another user's report | 403 error, data silently lost | Save succeeds |
| Super admin adds new equipment to another user's report | 403 error | Insert succeeds |
| Super admin deletes equipment from another user's report | 403 error | Delete succeeds |
| Report owner edits their own equipment | Works (uses "ALL" policy) | No change |

## Why Previous Fixes Didn't Help

The stale closure fix and navigation guard fix were both valid improvements, but they addressed secondary issues. The primary blocker was always the 403 from the database rejecting the write. No amount of state management fixes can save data when the database refuses to accept it.
