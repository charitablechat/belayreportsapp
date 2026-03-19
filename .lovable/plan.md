

## Replace Organization Dropdown with Role Dropdown in User Creation Dialog

### What
When creating a new user via the super admin panel, replace the "Organization (Optional)" dropdown and conditional role selector with a single "Role" dropdown containing three options: User, Admin, and Super Admin.

### Changes

| File | What |
|------|------|
| `src/components/admin/UserManagementDialog.tsx` | Replace organization dropdown + conditional role dropdown with a single always-visible Role dropdown (user/admin/super_admin). Remove `organizationId` from create form. Update `UserFormData` type to include `'super_admin'` in role union. Default role to `'inspector'` (labeled "User"). |
| `supabase/functions/admin-manage-user/index.ts` | Update `create` action: when role is provided without an `organizationId`, insert into `user_roles` with `organization_id: null` (matching the existing `grant_super_admin` pattern). This handles super_admin and admin roles that aren't org-scoped. |

### UI Result (Create mode)
- Email, Password, First Name, Last Name fields (unchanged)
- **Role** dropdown with options: "User" (`inspector`), "Admin" (`admin`), "Super Admin" (`super_admin`)
- No organization dropdown

### Backend Handling
The edge function already supports `role: 'super_admin'` in its type definition. The change ensures that when no `organizationId` is provided, the role is still inserted into `user_roles` with a null `organization_id`.

