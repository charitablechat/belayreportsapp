

# Three-Tier Permission Structure

## Goal

```text
Role            Admin Panel    DB Backups    Others' Reports
─────────────   ───────────    ──────────    ───────────────
Super Admin     ✓ Full         ✓ Yes         Read-only, invisible
Admin           ✓ Full         ✗ No          Full edit access
Regular User    ✗ None         ✗ No          Own reports only
```

## Problem

`useReportEditPermission` calls `getSuperAdminStatusWithCache()` which uses the `is_admin_or_above` RPC. Both admins and the super admin resolve to `isSuperAdmin=true`, so **both are currently read-only** on others' reports. Admins need to be able to edit.

## Changes

### 1. `src/lib/cached-auth.ts` — Add true super admin check

Add a new `getIsTrueSuperAdmin()` function that calls the existing `is_super_admin` RPC (already in the DB). This distinguishes kale@belayreports.com from regular admins. Include the same caching/offline-fallback pattern as `getAdminStatusWithCache`.

### 2. `src/hooks/useReportEditPermission.tsx` — Two-tier non-owner logic

- Import the new `getIsTrueSuperAdmin` function
- Add separate state: `isAdmin` (from `getSuperAdminStatusWithCache`) and `isTrueSuperAdmin` (from `getIsTrueSuperAdmin`)
- Update the permission logic:
  - **True super admin + not owner** → `canEdit: false, isReadOnly: true, readOnlyReason: null` (invisible, no traces)
  - **Admin + not owner** → `canEdit: true, isReadOnly: false` (full edit access)
  - **Neither** → `canEdit: false` (no access)
- Update the returned `isSuperAdmin` field to reflect the true super admin status

### 3. `src/hooks/useReportEditPermission.tsx` — Interface update

Add `isAdmin: boolean` to the `ReportEditPermission` interface so form pages can distinguish admin from super admin if needed (e.g., showing/hiding UI elements).

### 4. No changes needed to

- **Admin panel access** (`useRequireAdmin`) — already gates on `is_admin_or_above`, so both admins and super admin get in. No change needed.
- **Database backups tab** — already gated by `showBackupTab={currentUserId === BACKUP_ADMIN_ID}` in `SuperAdminDashboard.tsx`. Only kale's UUID sees it.
- **RLS policies** — admins already have UPDATE policies on report tables via `is_admin_or_above()`. Super admin has them via `is_super_admin()`. The client-side hook is what enforces the read-only behavior for super admin.

### Files Modified
- `src/lib/cached-auth.ts` — new `getIsTrueSuperAdmin()` with caching
- `src/hooks/useReportEditPermission.tsx` — two-tier admin vs super admin logic

