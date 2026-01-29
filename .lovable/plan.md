
# Force Sync Implementation Plan

## Overview
Add an explicit "Force Sync" mechanism that allows users to manually trigger a complete data synchronization on demand, while preserving the existing automatic sync functionality.

## Design Decisions

### UI Placement
- **Desktop**: Add a clearly labeled "Force Sync Now" button in the Dashboard user dropdown menu and on the Profile settings page
- **Mobile**: Add a refresh/sync icon button in the Dashboard header area, and include the same button in the user dropdown menu

### Component Design
Create a new `ForceSyncButton` component that:
- Shows "Force Sync Now" text on desktop
- Shows a circular refresh icon on mobile
- Displays a spinning animation while syncing
- Is disabled when offline
- Provides haptic feedback on mobile

### Feedback Mechanism
Toast notifications will show:
1. "Sync initiated..." when triggered
2. "Sync completed successfully" on success
3. "Sync failed: [error message]" on failure

---

## Technical Implementation

### 1. Extend PWA Context (`src/components/pwa/PWAProvider.tsx`)
Expose the `performSync` function from `useAutoSync` through the PWA context so it's accessible throughout the app.

```typescript
// Add to PWAContextType interface
forceSync: () => Promise<void>;

// In PWAProviderContent
const { performSync } = useAutoSync();

const forceSync = async () => {
  await performSync(false); // Pass false for non-silent mode
};

// Add to context value
forceSync,
```

### 2. Update `usePWA` Hook Return Type
The hook already returns the full context, so it will automatically include `forceSync`.

### 3. Create Force Sync Button Component (`src/components/pwa/ForceSyncButton.tsx`)

```typescript
// New component with:
// - Desktop: Button with "Force Sync Now" text
// - Mobile: Icon-only button with RefreshCw icon
// - Disabled when offline
// - Shows spinner when syncing
// - Toast notifications for feedback
// - Haptic feedback on mobile
```

### 4. Integrate into Dashboard (`src/pages/Dashboard.tsx`)
Add the Force Sync button:
- In the user dropdown menu (for both desktop and mobile)
- Optionally in the header next to the network status indicator (mobile)

### 5. Integrate into Profile Page (`src/pages/Profile.tsx`)
Add a "Data Sync" section with the Force Sync button for users who want to access it from settings.

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/components/pwa/PWAProvider.tsx` | Add `forceSync` to context interface and implementation |
| `src/components/pwa/ForceSyncButton.tsx` | **New file** - Force Sync button component |
| `src/pages/Dashboard.tsx` | Add ForceSyncButton to user dropdown menu |
| `src/pages/Profile.tsx` | Add Data Sync section with ForceSyncButton |

---

## Security Considerations

The Force Sync operation will:
- ✅ Use the existing `performSync()` function from `useAutoSync`
- ✅ Respect all existing RLS policies and `inspector_id` constraints
- ✅ Go through the same validation pipelines (`validateInspectionPackage`, etc.)
- ✅ Not bypass any backend validation logic
- ✅ Not modify `inspector_id` fields (immutability preserved)

The sync functions in `atomic-sync-manager.ts` already:
1. Verify `inspector_id` matches current user before syncing
2. Skip records that don't belong to the current user
3. Use proper RLS-protected Supabase queries
4. Validate all data packages before submission

---

## User Experience Flow

```
User clicks "Force Sync Now"
    ↓
Check if online → If offline, show "Cannot sync while offline" toast
    ↓
Show "Sync initiated..." toast
    ↓
Trigger haptic feedback (mobile)
    ↓
Execute performSync()
    ↓
On success: Show "Sync completed successfully" toast
On failure: Show "Sync failed: [error]" toast
    ↓
Update sync status indicators
```

---

## Component Details

### ForceSyncButton Component API

```typescript
interface ForceSyncButtonProps {
  variant?: 'default' | 'icon' | 'menu-item';
  className?: string;
}
```

- `variant="default"`: Full button with text (desktop)
- `variant="icon"`: Icon-only button (mobile header)
- `variant="menu-item"`: For use inside dropdown menus
