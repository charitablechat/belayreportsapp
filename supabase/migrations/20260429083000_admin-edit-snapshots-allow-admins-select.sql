-- Re-deploy the "Admins can view admin edit snapshots" SELECT policy on
-- admin_edit_snapshots.
--
-- Background: Migration 20260427131652 was authored to add BOTH an INSERT
-- policy AND a SELECT policy granting `is_admin_or_above()` access. The
-- pg_policy verification query that confirmed deployment to live Supabase
-- only listed the INSERT policy (`Admins can insert admin edit snapshots`)
-- and did NOT verify the SELECT half (`Admins can view admin edit
-- snapshots`). Diagnostic logging in PR #57 proved the admin INSERT
-- succeeds but a same-session SELECT cannot find the row, which is only
-- explainable by the SELECT policy being absent from live state.
--
-- The owner's pre-existing SELECT policy from the table-creation
-- migration (`original_owner_id = auth.uid()`) is unaffected and continues
-- to allow owners to view snapshots of their own reports.
--
-- This migration is idempotent: DROP IF EXISTS + CREATE POLICY, so
-- re-applying when the policy is already present is a no-op.
DROP POLICY IF EXISTS "Admins can view admin edit snapshots" ON public.admin_edit_snapshots;
CREATE POLICY "Admins can view admin edit snapshots"
  ON public.admin_edit_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_above());
