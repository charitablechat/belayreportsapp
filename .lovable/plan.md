

## Remove "Super Admin" Concept — Unify to "Admin" Role

**Goal**: Eliminate the `super_admin` role entirely. All admins (Josh, Brenda, Kale) get equal access to everything except the database backup system, which remains restricted to Kale only.

### Strategy

The most efficient approach: **modify the `is_super_admin()` database function to check for `admin` role instead**. This instantly updates all ~100 RLS policies without touching them individually. Then restrict backups separately.

---

### 1. Database Migration

**a) Redefine `is_super_admin()` to check for `admin` role:**
```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;
```
All existing RLS policies using `is_super_admin()` now apply to admins — zero policy changes needed.

**b) Create `is_backup_admin()` for Kale-only backup access:**
```sql
CREATE OR REPLACE FUNCTION public.is_backup_admin()
RETURNS BOOLEAN AS $$
  SELECT auth.uid() = '759e973e-2484-4db3-862a-0cb2ec6d6ea3'
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;
```

**c) Update backup RLS policies** (backup_history table + database-backups storage) to use `is_backup_admin()` instead of `is_super_admin()`.

**d) Update user_roles data:**
- Change Kale's role from `super_admin` → `admin`
- Ensure Josh and Brenda already have `admin` (they should)

---

### 2. Edge Functions (6 files)

| File | Change |
|------|--------|
| `export-full-backup/index.ts` | Check Kale's user ID instead of `super_admin` role |
| `restore-full-backup/index.ts` | Check Kale's user ID instead of `super_admin` role |
| `admin-manage-user/index.ts` | Use `is_admin_or_above` RPC; remove `grant_super_admin`/`revoke_super_admin` actions; remove `super_admin` from role options |
| `generate-inspection-pdf/index.ts` | Check for `admin` role instead of `super_admin` |
| `generate-training-pdf/index.ts` | Check for `admin` role instead of `super_admin` |
| `check-overdue-reports/index.ts`, `send-push-notification/index.ts`, `send-notification-email/index.ts`, `send-training-pdf-email/index.ts`, `cleanup-duplicate-summaries/index.ts` | Query `admin` role instead of `super_admin` |

---

### 3. Frontend Changes (~15 files)

**Auth/Hooks:**
- `useRequireSuperAdmin.tsx` → delete; replace usage with `useRequireAdmin`
- `useRequireAdmin.tsx` → remove the secondary `is_super_admin` RPC call and `isSuperAdmin` return value
- `cached-auth.ts` → remove `getSuperAdminStatusWithCache` and related caching; replace with admin status check

**Pages:**
- `SuperAdminDashboard.tsx` → use `useRequireAdmin` guard; remove super admin grant/revoke dialog and related state; hide "Database Backups" tab for non-Kale users (check user ID client-side)
- `Dashboard.tsx` → replace all `isSuperAdmin` checks with `isAdmin` using `is_admin_or_above` RPC

**Components:**
- `AuthenticatedHeader.tsx` → check `admin` role instead of `super_admin`; rename `isSuperAdmin` → `isAdmin`
- `AdminTabsSection.tsx` → conditionally show/hide backup tab based on user ID prop
- `UserManagementDialog.tsx` → remove `super_admin` from role dropdown
- `user-avatar.tsx` → rename `isSuperAdmin` prop to `isAdmin`
- `DeveloperNotesCard.tsx`, `KnownIssuesCard.tsx` → rename prop `isSuperAdmin` → `isAdmin`
- `DashboardReportsSection.tsx`, `DashboardFilters.tsx` → rename prop
- `useReportEditPermission.tsx` → rename to `isAdmin`
- Various offline-storage/report files that pass `isSuperAdmin` parameter → rename

**Text changes**: All UI strings saying "Super Admin" become "Admin".

---

### Summary

- **1 migration** (redefine function + new function + update backup policies + update roles data)
- **~10 edge function files** updated
- **~15 frontend files** updated
- Net effect: Josh, Brenda, Kale all see the admin dashboard and manage everything equally; only Kale sees the Database Backups tab

