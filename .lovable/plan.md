

## Rename "Super Admin" → "Admin" in UI

### Summary
Remove all user-facing references to "Super Admin" and replace with just "Admin." The underlying database role (`super_admin`) and all access control logic remain unchanged — this is purely a display/label change.

### Scope

**UI text changes only** — no database migrations, no RLS changes, no role renaming in `user_roles` table.

### Files to Update

| File | What changes |
|------|-------------|
| `src/components/admin/UserManagementDialog.tsx` | Change `<SelectItem value="super_admin">Super Admin</SelectItem>` → `Admin` label. Remove the separate "Admin" option since all admins now have full access, or keep both but relabel super_admin as "Admin" |
| `src/pages/SuperAdminDashboard.tsx` | Rename component display title, button labels, dialog text referencing "Super Admin" → "Admin" |
| `src/components/UserProfileDropdown.tsx` | Badge text "Admin" (already says "Admin" — confirm), comment cleanup |
| `src/components/admin/DataRecoveryTool.tsx` | Update UI strings like "Super Admin only", snapshot descriptions |
| `src/components/admin/AdminTabsSection.tsx` | Any tab labels or descriptions mentioning "Super Admin" |
| `src/components/admin/ReportOwnershipTool.tsx` | UI text referencing super admin permissions |
| `src/components/ui/user-avatar.tsx` | Rename `isSuperAdmin` prop (optional, internal) |
| `src/hooks/useRequireSuperAdmin.tsx` | Rename to clarify (optional, internal-only) |
| `src/hooks/useRequireAdmin.tsx` | Comment cleanup |
| `src/components/AuthenticatedHeader.tsx` | Query key/variable naming (optional, internal) |
| `src/lib/offline-storage.ts` | Comment cleanup ("Super admins see all" → "Admins see all") |
| `supabase/functions/admin-manage-user/index.ts` | Response messages referencing "super admin" |
| `supabase/functions/send-notification-email/index.ts` | Log messages referencing "super admin" |
| `supabase/functions/cleanup-duplicate-summaries/index.ts` | Error message "Super admin access required" → "Admin access required" |

### Key decisions
- The `super_admin` value in the database enum stays as-is — renaming an enum requires a migration and risks breaking existing data
- The `UserManagementDialog` role selector should either hide the separate "admin" role (since it's now redundant) or consolidate: show only "Inspector", "Trainer", and "Admin" where selecting "Admin" maps to the `super_admin` database role
- All internal variable names like `isSuperAdmin` can optionally be renamed but this is low priority since users never see them

### Approach
1. Update all user-facing strings (labels, badges, toasts, dialog text, error messages) from "Super Admin" to "Admin"
2. In the role selector, remove the old "admin" option and relabel "super_admin" as "Admin" — or map "Admin" selection to `super_admin` role internally
3. Clean up code comments for consistency

