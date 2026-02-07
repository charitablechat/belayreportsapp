

# Add Unsynced Data Visibility for Users and Admins - v2.4.15

## Problem

When a user fills out a report offline and comes back online, they have no way to **see** that reports are pending sync. The Force Sync button exists but gives no indication of how many items are queued. Users and admins need clear visibility into unsynced local data.

## What Already Works (No Changes Needed)

- Force Sync button triggers full atomic sync of all report types
- Auto-sync fires immediately on reconnection and periodically
- Admin Data Recovery Tool shows all IndexedDB contents with per-item sync buttons

## Changes

### 1. Add unsynced count badge to Force Sync button

Show a red badge with the number of pending items directly on the Force Sync menu item in the profile dropdown. This gives users instant visibility.

**File: `src/components/pwa/ForceSyncButton.tsx`**
- Accept `unsyncedCount` as an optional prop
- Display a red count badge next to "Force Sync Now" text when count > 0
- After sync completes, the count updates automatically (already handled by useAutoSync)

### 2. Add a "Pending Sync" banner on the Dashboard

When there are unsynced items, show a small alert banner at the top of the dashboard with the count and a sync button.

**File: `src/pages/Dashboard.tsx`**
- Read `unsyncedCount` from the existing `usePWA()` hook (already available)
- Show a compact alert banner when `unsyncedCount > 0` with text like "3 reports pending sync" and an inline "Sync Now" button
- Banner disappears when count reaches 0

### 3. Pass unsynced count to ForceSyncButton in dropdown

**File: `src/components/UserProfileDropdown.tsx`**
- Import `usePWA` to get `unsyncedCount`
- Pass it to the `ForceSyncButton` component

### 4. Version bump

**File: `vite.config.ts`**
- Bump to v2.4.15

## Technical Details

### ForceSyncButton badge (menu-item variant)

```text
Before:  [refresh icon] Force Sync Now
After:   [refresh icon] Force Sync Now  [3]  (red badge)
```

### Dashboard banner (when unsynced > 0)

```text
+------------------------------------------------------+
| [cloud icon] 3 reports pending sync    [Sync Now]    |
+------------------------------------------------------+
```

- Uses existing `usePWA().unsyncedCount` -- no new data fetching needed
- Uses existing `usePWA().forceSync()` for the sync action
- Banner uses `Alert` component with `variant="default"` and amber/orange styling

### Files Changed

| File | Change |
|------|--------|
| `src/components/pwa/ForceSyncButton.tsx` | Add optional `unsyncedCount` prop, show badge in menu-item variant |
| `src/components/UserProfileDropdown.tsx` | Pass `unsyncedCount` from `usePWA()` to ForceSyncButton |
| `src/pages/Dashboard.tsx` | Add pending sync banner when `unsyncedCount > 0` |
| `vite.config.ts` | Bump to v2.4.15 |

