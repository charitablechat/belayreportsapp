## Root cause

When a regular user (inspector or trainer) deletes their own report, the app performs a "soft delete" by `UPDATE`-ing the row with `deleted_at`, `deleted_by`, and `retention_until`. Two database-level problems combine to break this for non-admins:

### Problem 1 — `is_super_admin()` is wrong

```sql
CREATE FUNCTION public.is_super_admin() ...
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'   -- ← bug
  )
```

It checks for role `'admin'` but the enum has both `'admin'` and `'super_admin'`. This means:

- True super-admins (`role = 'super_admin'`) are NOT recognized and lose access to several policies that rely on `is_super_admin()`.
- Regular admins are silently elevated to super-admin everywhere `is_super_admin()` is used.

### Problem 2 — Soft-delete UPDATE returns no visible row to the user

The user-level UPDATE policies on `inspections` and `trainings` are:

```
USING       (inspector_id = auth.uid())
WITH CHECK  (inspector_id = auth.uid())
```

The user-level SELECT policy is:

```
USING (inspector_id = auth.uid() AND deleted_at IS NULL)
```

After the `UPDATE` sets `deleted_at`, the row instantly stops matching the SELECT policy. The PostgREST `UPDATE … RETURNING` step returns **0 rows** to the client. Combined with `inspection_summary` / child-row child-row read paths, the request looks like a failure to the UI, leaving the report visible.

`daily_assessments` also has the same SELECT-after-UPDATE pattern and is at risk; the symptom there can be inconsistent UI updates rather than an outright error, depending on the client code path.

## Fix

### 1. Database migration

- Rewrite `public.is_super_admin()` to check `role = 'super_admin'`.
- Add a tightening clause `(deleted_at IS NULL)` to the **USING** side of the user UPDATE policies on `inspections`, `trainings`, and `daily_assessments` so a user can only soft-delete a row that is currently visible to them. (The `daily_assessments` policy already has this — apply the same pattern uniformly.)
- Add a small SECURITY DEFINER RPC `soft_delete_report(table_name, record_id)` that performs the UPDATE on behalf of the owner and returns `{ success boolean, id uuid }`. Bypassing the RETURNING/RLS visibility gap with a definer function gives the client an unambiguous success/failure signal without weakening any read policies.
  - The RPC verifies `auth.uid() = inspections.inspector_id` (or matching column) before writing and rejects otherwise.
  - It writes `deleted_at = now()`, `deleted_by = auth.uid()`, `retention_until = now() + interval '60 days'`.

### 2. Client changes

- `src/hooks/useSoftDelete.tsx`
  - Replace the inline `.update().eq('id', …)` with a call to the new `soft_delete_report` RPC.
  - Surface the RPC's structured error to the toast.
- `src/pages/Dashboard.tsx` (`handleDeleteConfirm`)
  - Replace each of the three branches' `.update(softDeleteData)` calls with the same RPC call.
  - Keep the existing offline queue behaviour (`queueOperation`/`queueAssessmentOperation`/`queueTrainingOperation`) unchanged for the offline path.

### 3. Verification

After deploy:
- Sign in as `allison.hickey93@gmail.com` (trainer) and delete a training they own — should succeed and disappear from the dashboard.
- Sign in as an inspector and delete an inspection and a daily assessment they own — both should succeed.
- Confirm a regular admin can still delete any report (relies on the `is_admin_or_above()` policies which are unchanged).
- Confirm the deleted record appears in the super-admin Recovery panel (super-admin SELECT policy now correctly recognizes role `super_admin`).
- Confirm restoring from the Recovery panel still works.
- Confirm offline soft-delete still queues and replays via `queued-soft-delete-processor`.

## Out of scope

- The 60-day cleanup job, recovery UI, and child-row/photo cascade behaviour are unchanged.
- No change to `is_admin_or_above()` — that function is already correct.
