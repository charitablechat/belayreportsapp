## Fix: Allow regular admins to insert admin edit snapshots

### Problem confirmed

Querying `pg_policy` for `admin_edit_snapshots` returned only:
- `Super admins can manage admin edit snapshots` (ALL — but super-admin only)
- `Users can view snapshots of their own reports` (SELECT only)

There is **no INSERT policy for regular admins**. So when a non-super-admin (e.g., Josh/Brenda with the `admin` role) edits another user's report, `capturePreEditSnapshot` silently fails RLS and no snapshot is saved — meaning admin edits aren't reversible.

### Migration to apply

```sql
DROP POLICY IF EXISTS "Admins can insert admin edit snapshots"
  ON public.admin_edit_snapshots;

CREATE POLICY "Admins can insert admin edit snapshots"
ON public.admin_edit_snapshots
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin_or_above());
```

### Why this is safe

- Uses the project's standard `is_admin_or_above()` SECURITY DEFINER function (matches the rest of the codebase).
- Only widens **INSERT**, not SELECT — so admins can write snapshots of edits they perform, but who can *read* snapshots is unchanged (super admins see all; users see snapshots of their own reports).
- No schema changes, no data changes, no app-code changes required.

### Files touched

- New migration: `supabase/migrations/<timestamp>_admin_edit_snapshots_admin_insert_policy.sql`

Approve this plan and I'll apply the migration immediately.