

# Add "Data Recovery" to Profile Dropdown for All Users

## Overview
Add a "Data Recovery" menu item in the UserProfileDropdown (under "Check for Updates" / "Force Sync Now") that opens a sheet/dialog showing localStorage snapshots and IndexedDB backups. Regular users get **view + restore only** access (no delete, no export). The existing `DataRecoveryTool` component is reused with a permission-aware mode.

## What Changes

### 1. Create a lightweight wrapper: `src/components/UserDataRecoverySheet.tsx`
- A Sheet (bottom drawer on mobile) triggered from the dropdown
- Renders a simplified version of the existing `LocalSnapshotsPanel` and `IndexedDBRecoveryPanel`
- **No delete buttons** -- only Restore actions
- **No export buttons** -- keeps UI simple for regular users
- Shows snapshot count, sync status, organization name, and one-click restore
- Uses existing functions from `local-backup-ledger.ts` and `offline-storage.ts`

### 2. Modify `src/components/admin/DataRecoveryTool.tsx`
- Extract `LocalSnapshotsPanel` and `IndexedDBRecoveryPanel` into exported components
- Add an `allowDelete?: boolean` prop (defaults to `true` for backward compatibility in the admin dashboard)
- When `allowDelete` is `false`, hide the Delete and Export buttons, showing only the Restore button

### 3. Modify `src/components/UserProfileDropdown.tsx`
- Add a "Data Recovery" menu item with a `Database` icon after "Force Sync Now"
- Clicking it opens the `UserDataRecoverySheet`
- Available to **all authenticated users** (not just super admins)

## Technical Details

### Data Recovery Sheet component structure
```
UserDataRecoverySheet (Sheet component)
  -> LocalSnapshotsPanel (allowDelete=false)
     - Lists all localStorage backup snapshots
     - Shows: type, organization, sync status, last saved, size
     - Action: Restore only (writes snapshot back into IndexedDB)
  -> IndexedDBRecoveryPanel (allowDelete=false)
     - Shows all IndexedDB records with sync status
     - Action: Force-sync individual unsynced records to the server
     - No delete capability
```

### Security considerations
- No new database tables or RLS changes needed -- this reads only local device storage (localStorage + IndexedDB)
- No server-side data is exposed that isn't already accessible to the authenticated user
- Delete capability remains exclusive to the Super Admin dashboard
- Restore only writes data back into the user's own local IndexedDB stores

### Files changed

| File | Change |
|------|--------|
| `src/components/admin/DataRecoveryTool.tsx` | Export `LocalSnapshotsPanel` and `IndexedDBRecoveryPanel` with `allowDelete` prop |
| `src/components/UserDataRecoverySheet.tsx` | New file -- Sheet wrapper rendering both panels with `allowDelete=false` |
| `src/components/UserProfileDropdown.tsx` | Add "Data Recovery" dropdown item that opens the sheet |

