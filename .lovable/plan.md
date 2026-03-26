

## Fix: "Failed to delete report" — RLS UPDATE Policy Issue

### Root Cause

The database logs confirm: `new row violates row-level security policy for table "inspections"` when attempting the soft-delete `.update()` call.

Three UPDATE policies exist on each report table (`inspections`, `trainings`, `daily_assessments`):

1. **"Inspectors can update their own [X]"** — `USING (auth.uid() = inspector_id)`, **WITH CHECK: NULL**
2. **"Super admins can update all [X]"** — `USING (is_super_admin())`, `WITH CHECK (is_super_admin())`
3. **"Users can update their own active [X]"** — `USING ((inspector_id = auth.uid()) AND (deleted_at IS NULL))`, `WITH CHECK (inspector_id = auth.uid())`

Policy #1 has a **NULL WITH CHECK**. When PostgreSQL evaluates this, it falls back to the USING expression against the NEW row, but the behavior with NULL `polwithcheck` in `pg_policy` can be unreliable when combined with other policies that DO have explicit WITH CHECK clauses. Additionally, **admin-level users** (non-super-admin) have no UPDATE policies at all, so they cannot soft-delete reports they oversee.

### Fix — Database Migration

**Single migration** to fix all three tables (`inspections`, `trainings`, `daily_assessments`):

1. **Drop** the old redundant policies with NULL WITH CHECK:
   - "Inspectors can update their own inspections"
   - "Inspectors can update their own assessments"  
   - "Trainers can update their own trainings"

2. **Replace** the "Users can update their own active [X]" policies with a cleaner version that:
   - USING: `inspector_id = auth.uid()` (no `deleted_at IS NULL` filter — owners should be able to soft-delete their own records)
   - WITH CHECK: `inspector_id = auth.uid()` (explicit, not NULL)

3. **Add** admin-level UPDATE policies using `is_admin_or_above()`:
   - Admins can update all reports (for soft-delete and other admin actions)

### Files to Modify

| Change | Detail |
|--------|--------|
| DB Migration | Drop 3 old UPDATE policies, update 3 "active" UPDATE policies, add 3 admin UPDATE policies |

No application code changes needed — the Dashboard soft-delete logic is correct; only the RLS policies need fixing.

