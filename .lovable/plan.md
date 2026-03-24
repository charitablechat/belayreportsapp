## Add "Trainer" Role to User Management

### Summary

Add `trainer` to the existing role enum, update the UI dropdown to show all four roles (Inspector, Trainer, Admin), and assign existing users without a role to `trainer` by default.

### Database Migration

Add `trainer` value to the `app_role` enum and backfill any users in `auth.users` who have no entry in `user_roles`:

```sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trainer';

-- Assign 'inspector' role to any existing users who have no role
INSERT INTO public.user_roles (user_id, role, organization_id)
SELECT p.id, 'inspector'::app_role, NULL
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
)
ON CONFLICT DO NOTHING;
```

### Files Changed


| File                                            | Change                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/components/admin/UserManagementDialog.tsx` | Add `'trainer'` to role type union; add `<SelectItem value="trainer">Trainer</SelectItem>` to the dropdown |
| `supabase/functions/admin-manage-user/index.ts` | Add `'trainer'` to the role type unions in `CreateUserPayload` and `UpdateUserPayload`                     |


### UI Detail

The role dropdown will show:

- **Inspector** (`inspector`)
- **Trainer** (`trainer`)
- **Admin** (`admin`)
- **Super Admin** (`super_admin`)

Default for new users remains `inspector`.