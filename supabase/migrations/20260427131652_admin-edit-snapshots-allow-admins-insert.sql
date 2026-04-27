-- Allow `admin` role users (Josh / Brenda) to insert into admin_edit_snapshots.
--
-- Background: the original policy on this table (migration 20260226134608)
-- was "Super admins can manage" gated on `is_super_admin()`. At the time
-- `is_super_admin()` returned true for the `admin` role (per migration
-- 20260401035921), so admins editing other users' reports successfully
-- captured pre-edit snapshots.
--
-- Migration 20260424174047 correctly tightened `is_super_admin()` to match
-- the `super_admin` role only. That fix was right for the *role check*, but
-- it had an unintended downstream effect on this table: the `admin_edit_snapshots`
-- policy was never updated, so admin-role users (who CAN edit other users'
-- reports per `useReportEditPermission` and the "Admins can update all
-- inspections" RLS policy) can no longer insert their pre-edit snapshots.
-- The capture path silently fails and the audit trail is lost.
--
-- Note: super_admin (kale) is strictly read-only per useReportEditPermission
-- and never triggers the snapshot capture path, so the previous policy was
-- effectively writing zero rows since 20260424174047.
--
-- Fix: add an explicit INSERT policy that mirrors the parent inspections
-- table's "Admins can update" policy (also `is_admin_or_above()`).
DROP POLICY IF EXISTS "Admins can insert admin edit snapshots" ON public.admin_edit_snapshots;
CREATE POLICY "Admins can insert admin edit snapshots"
  ON public.admin_edit_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_above());

-- Mirror SELECT so admins can read back their own captures (needed for the
-- audit-history UI and for e2e oracles).
DROP POLICY IF EXISTS "Admins can view admin edit snapshots" ON public.admin_edit_snapshots;
CREATE POLICY "Admins can view admin edit snapshots"
  ON public.admin_edit_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_above());
