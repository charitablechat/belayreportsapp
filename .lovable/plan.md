

## Update Notification System -- Developer-Focused Minimal Brutalism

### Overview
Replace the current toast-based update notification with a persistent, non-intrusive update badge integrated into the `AuthenticatedHeader`. When an update is detected (automatically or manually), a small badge appears near the user avatar. Clicking it opens a focused update control panel. No automatic updates or reloads occur -- the user is always in control.

### Architecture

```text
+---------------------------+
|  AuthenticatedHeader      |
|  [Update Badge] [Avatar]  |  <-- Badge only appears when update available
+---------------------------+
        |
        v (click)
+---------------------------+
| Update Control Panel      |
| (Sheet / Dialog)          |
|                           |
| Status: UPDATE AVAILABLE  |
| Current: v2.9.2           |
|                           |
| [Check Now]  [Apply Update]
| [Force Refresh (Cache)]  |
+---------------------------+
```

### Changes

#### 1. New Component: `UpdateBadge` (`src/components/pwa/UpdateBadge.tsx`)
A small, persistent indicator that sits next to the user avatar in the `AuthenticatedHeader`. Uses the Minimal Brutalism aesthetic (monospace, high contrast, sharp edges).

- **No update**: Hidden (renders nothing)
- **Update available**: Shows a small pulsing dot/badge with "UPD" or a refresh icon
- **Checking**: Shows a spinner state
- Clicking opens the `UpdateControlPanel`

#### 2. New Component: `UpdateControlPanel` (`src/components/pwa/UpdateControlPanel.tsx`)
A Sheet (slide-in panel) with developer-focused UI:

- **Current version** display (monospace, from `APP_VERSION`)
- **Status line**: `NO UPDATES` / `UPDATE PENDING` / `CHECKING...` / `APPLYING...`
- **Last checked** timestamp (stored in state/localStorage)
- **[Check Now]** button -- triggers manual SW update check
- **[Apply Update]** button -- only enabled when `needsUpdate` is true; calls `updateAndReload()`
- **[Force Refresh]** -- existing cache-clear logic from `ManualUpdateButton`
- Unsynced data warning before applying (reuses existing pattern)

Styled with: `bg-black/90`, `backdrop-blur-xl`, `border border-white/20`, `font-mono`, amber/green accent colors, CRT scanline overlay (matching `VersionInfoModal`)

#### 3. Modify `UpdateNotification` (`src/components/pwa/UpdateNotification.tsx`)
- Remove the toast-based notification entirely
- Keep the `controllerchange` auto-reload listener (needed after SW activates)
- The component becomes minimal -- just the controller change listener

#### 4. Modify `AuthenticatedHeader` (`src/components/AuthenticatedHeader.tsx`)
- Import and render `UpdateBadge` next to the `UserProfileDropdown`
- Position it to the left of the avatar within the existing glassmorphic container

#### 5. Modify `UserProfileDropdown` (`src/components/UserProfileDropdown.tsx`)
- Keep the `ManualUpdateButton` dropdown item as-is (it still works as a secondary access point)
- No changes needed here

#### 6. Add background auto-check interval to `usePWAUpdate`
- The existing hook already checks hourly (every 60 min). This is sufficient.
- Add a `lastChecked` timestamp to the hook's return value so the UI can display it.
- Add a `checkForUpdates` method to the return value for manual trigger from the new panel.

### Updated `usePWAUpdate` Return Type
```typescript
interface PWAUpdateStatus {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  lastChecked: Date | null;       // NEW
  isChecking: boolean;            // NEW
  checkForUpdates: () => Promise<void>;  // NEW
}
```

### Updated `PWAContextType` (in PWAProvider)
Add the new fields to the context so they're available app-wide:
```typescript
lastUpdateCheck: Date | null;
isCheckingForUpdate: boolean;
checkForUpdates: () => Promise<void>;
```

### UI Specification (Minimal Brutalism)

**Update Badge (small indicator):**
- 28x28px container, `border border-white/30`, `bg-black/80 backdrop-blur-md`
- Inner: `RefreshCw` icon (14px), amber color when update pending
- Pulsing amber dot (4px) in top-right corner when update available
- Monospace tooltip on hover: `UPDATE AVAILABLE`

**Update Control Panel (Sheet):**
- Dark background matching `VersionInfoModal` aesthetic
- CRT scanline overlay
- Monospace font throughout
- Status displayed as colored badge: green = `UP TO DATE`, amber = `UPDATE PENDING`, blue = `CHECKING`
- Buttons with sharp borders, no rounded corners, uppercase labels
- Timestamp in `HH:MM:SS` format

### File Summary

| File | Action |
|------|--------|
| `src/components/pwa/UpdateBadge.tsx` | Create -- persistent update indicator |
| `src/components/pwa/UpdateControlPanel.tsx` | Create -- full update management sheet |
| `src/components/pwa/UpdateNotification.tsx` | Modify -- remove toast, keep controller listener |
| `src/components/AuthenticatedHeader.tsx` | Modify -- add UpdateBadge next to avatar |
| `src/hooks/usePWAUpdate.tsx` | Modify -- add lastChecked, isChecking, checkForUpdates |
| `src/components/pwa/PWAProvider.tsx` | Modify -- expose new update fields in context |
| `src/hooks/usePWA.tsx` | Modify -- add new fields to fallback context |

