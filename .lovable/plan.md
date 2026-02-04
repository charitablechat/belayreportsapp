
# Re-Enable Toast Notifications on Mobile for Sync/Update Visibility

## Problem Analysis

Based on the codebase review, I've identified why mobile users can't see sync and update notifications:

### Current Architecture (Toast Suppression)
1. **`MobileAwareToaster` and `MobileAwareSonner`** (in `src/components/ui/mobile-aware-toaster.tsx`) return `null` on mobile devices - completely hiding all toast overlays
2. **Sonner's toast wrapper** (in `src/components/ui/sonner.tsx`) routes ALL toasts to the notification center on mobile
3. **The notification center** is only visible via the Profile page Sheet - users must explicitly navigate there to see status updates
4. **PWA Update notifications** (`UpdateNotification.tsx`) use `toast.success()` from sonner, which gets silently routed to the notification center

### Evidence from Logs
The database logs show successful auth requests from both `rwreports.com` (production) and the preview domain, indicating mobile devices ARE connecting. However, users have no visibility because toast feedback is suppressed.

## Solution: Conditional Toast Re-enablement

Re-enable toast notifications on mobile for **critical system messages** while keeping the notification center for routine operations. This provides the best of both worlds:
- **Critical toasts visible on screen**: Sync status, update availability, errors
- **Routine operations still quiet**: Regular saves, minor info messages

## Implementation Changes

### File 1: `src/components/ui/mobile-aware-toaster.tsx`

**Current behavior:** Returns `null` on mobile (hides all toasts)

**New behavior:** Always render toasters, let the toast wrapper handle filtering

```typescript
// BEFORE
export function MobileAwareSonner() {
  if (isMobile()) {
    return null;
  }
  return <SonnerToaster />;
}

// AFTER
export function MobileAwareSonner() {
  // Always render - toast filtering happens at the toast() call level
  return <SonnerToaster />;
}
```

### File 2: `src/components/ui/sonner.tsx`

**Current behavior:** Routes ALL toasts to notification center on mobile

**New behavior:** Only route non-critical messages to notification center; show critical toasts

Add a "critical message" check that allows sync, update, and error toasts to display normally:

```typescript
function isCriticalMessage(message: string, type: string): boolean {
  // Always show errors
  if (type === 'error') return true;
  
  // Always show sync status
  if (/sync|syncing|synced/i.test(message)) return true;
  
  // Always show update notifications
  if (/update|version|new version/i.test(message)) return true;
  
  // Always show offline/online status
  if (/offline|online|connection/i.test(message)) return true;
  
  return false;
}
```

### File 3: `src/hooks/useAutoSync.tsx`

**Current behavior:** Calls `addSyncNotification()` silently

**New behavior:** Show toast for sync completion on mobile for visibility

Add explicit toast calls for sync start/complete:

```typescript
// After successful sync
toast.success('Data synced successfully');

// On sync start (optional - for visibility)
// Already have this in console logs, expose to user
```

### File 4: Update version to `v2.2.40`

Increment version in `vite.config.ts` to track this change.

## Summary of Changes

| File | Change |
|------|--------|
| `src/components/ui/mobile-aware-toaster.tsx` | Always render toasters on mobile |
| `src/components/ui/sonner.tsx` | Add critical message bypass for mobile filtering |
| `src/hooks/useAutoSync.tsx` | Add visible toast for sync completion |
| `vite.config.ts` | Update version to v2.2.40 and timestamp |

## Expected Outcome

After these changes, mobile users will see:
1. **Toast when sync completes**: "Data synced successfully"
2. **Toast when update is available**: "Update Available" with "Update Now" button
3. **Toast on errors**: All error messages remain visible
4. **Toast on network reconnection**: "Network reconnected" feedback

Routine save messages will still route to the notification center to avoid interruption during data entry.
