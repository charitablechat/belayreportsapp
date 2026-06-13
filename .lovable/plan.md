## Root cause

`inspections.inspector_id` has a foreign key `inspections_inspector_id_profiles_fkey` pointing at `public.profiles.id`. When you sign in as `kale@belayreports.com` and try to create/edit an inspection, the insert sets `inspector_id = auth.uid()` — but there is **no row in `public.profiles`** for that user, so the FK fails with:

> insert or update on table "inspections" violates foreign key constraint "inspections_inspector_id_profiles_fkey"

Verified via DB query:

```
auth.users.id           = 8e9d7912-c82b-467c-8302-89ebb0bdd55c
auth.users.email        = kale@belayreports.com
public.profiles row     = NULL  ← missing
```

The `admin-bootstrap-superadmin` edge function (created earlier this session) provisioned the auth user and granted the `super_admin` role, but it never inserted a matching `profiles` row. The project has no `on_auth_user_created` trigger that auto-creates profiles, so any user created via the admin API directly (rather than through the normal sign-up flow that triggers profile creation in the app) ends up profile-less and cannot author reports.

## Why this only surfaced now

Every other operating user was created through the app's normal flow, which inserts the profile row alongside sign-up. The super-admin bootstrap bypassed that path, leaving an orphan auth user. Any FK that points at `profiles.id` (inspections, trainings, daily_assessments, photos, etc.) will reject writes from this account until the profile exists.

## Remediation plan

**Step 1 — Backfill the missing profile (data fix, narrow & reversible)**

Single-row `INSERT` via the data tool:

```sql
INSERT INTO public.profiles (id, first_name, last_name, is_active)
VALUES ('8e9d7912-c82b-467c-8302-89ebb0bdd55c', 'Kale', NULL, true)
ON CONFLICT (id) DO NOTHING;
```

- Scope: one row, keyed by the known auth user id.
- Rollback: `DELETE FROM public.profiles WHERE id = '8e9d7912-...';` (no FK-dependent rows exist yet for this user).
- Verification: re-run the join query and confirm `profile_id` is no longer null; then retry "Create inspection" in the UI and confirm the FK error is gone.

**Step 2 — Harden `admin-bootstrap-superadmin` so this can't recur**

Add an idempotent `profiles` upsert immediately after the auth user is created/looked up, before the role grant:

```ts
await admin.from("profiles").upsert(
  { id: userId, first_name: "Kale", is_active: true },
  { onConflict: "id", ignoreDuplicates: true }
);
```

- Idempotent: safe to re-run.
- Narrow: only touches the bootstrap function, no schema change.

**Step 3 — Audit for other orphan auth users (read-only, optional)**

```sql
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
```

If the list is empty, no further action. If non-empty, surface the list to you before any further backfill — do not bulk-insert without confirmation.

## What I will NOT change

- No schema migrations, no new triggers, no FK changes.
- No edits to the inspection-create code path — the FK behavior is correct; the data was missing.
- No changes to other users, roles, or RLS policies.
- No automated bulk backfill in Step 3 without your approval.

## Verification after Steps 1 & 2

1. `SELECT id FROM public.profiles WHERE id = '8e9d7912-c82b-467c-8302-89ebb0bdd55c';` returns one row.
2. In the app as `kale@belayreports.com`, "New Inspection" succeeds without the FK toast.
3. Edge function redeploy log shows `admin-bootstrap-superadmin` deployed cleanly.

Approve and I'll execute Steps 1 and 2 (and run Step 3 read-only).