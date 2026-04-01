

## Grant Super Admin Role to kale@belayreports.com

**What**: Insert a `super_admin` role for user `kale@belayreports.com` (ID: `759e973e-2484-4db3-862a-0cb2ec6d6ea3`) into the `user_roles` table. This user currently has no roles assigned.

### Change

**Database migration** — single INSERT statement:

```sql
INSERT INTO public.user_roles (user_id, role, organization_id)
VALUES ('759e973e-2484-4db3-862a-0cb2ec6d6ea3', 'super_admin', NULL)
ON CONFLICT (user_id, role) DO NOTHING;
```

No code changes needed. One migration, one row inserted.

