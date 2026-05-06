## Why the cards say "Unknown"

The dashboard query joins each report row to its inspector's profile:

```
inspector:profiles!...fkey(first_name, last_name, avatar_url)
```

That join is silently filtered by RLS. The current `profiles` SELECT policies only let a user read a profile when:

1. It's their own profile (`auth.uid() = id`), OR
2. They are the **true Super Admin** (`is_super_admin()`), OR
3. They share an `organization_members` row with that profile.

There is **no policy that lets an `admin` read other users' profiles**. So when an admin opens the dashboard and sees reports authored by inspectors they don't share an org membership with, the join comes back `null` → `ReportCard.getInspectorName()` falls through to `"Unknown"` and the avatar shows `?`.

`useProfileMap`'s lazy fallback (`getCachedProfile` → `supabase.from('profiles').select(...)`) hits the same RLS wall, so it can't recover the name either.

I confirmed in the DB that every report listed has a real `inspector_id` pointing at a populated profile (Luke Benton, Test Account, etc.) — the data exists, only the read permission is missing for the admin viewing the dashboard.

This same gap also breaks name resolution in the Audit Log panel for non-super-admins (`audit_resolve_users` is gated to `is_super_admin()` only).

## The fix

Give the `admin` role (and the read-only super_admin) RLS permission to read profile display fields. This matches the existing `is_admin_or_above()` policies already in place on `inspections`, `trainings`, and `daily_assessments` — admins can already see those reports, they just can't see who authored them.

### Migration

```sql
-- Let admins read profiles so dashboard joins resolve
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_above());

-- Allow admins to resolve names in the audit log too
CREATE OR REPLACE FUNCTION public.audit_resolve_users(_user_ids uuid[])
RETURNS TABLE(id uuid, first_name text, last_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.first_name, p.last_name
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
    AND public.is_admin_or_above();
$$;
```

### What this changes

- Dashboard inspector names + avatars resolve on first paint for admins.
- `useProfileMap`'s lazy fallback succeeds for locally-saved drafts whose join was stripped.
- Audit log shows real names for admins, not just super admin.

### What this does NOT change

- No client code changes — the queries already request the join; they just start returning data.
- Regular (non-admin) users keep the existing rules: own profile + organization-mates only.
- Super Admin invisibility in the UI is unchanged (that's UI logic, not RLS).
- No new sensitive columns are exposed beyond what the joins already request (first_name, last_name, avatar_url, acct_number).

After approval I'll run the migration and verify the cards show real names.
