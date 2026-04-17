

The user's request describes generic Apple device troubleshooting (iCloud, iPadOS updates, network reset) — that's not what this app does. This is a PWA (RopeWorks reports) running in Safari on iPad. The real issue they likely mean: **the PWA's own sync and update mechanisms are unreliable on iPad/Safari**.

Known iOS Safari PWA limitations from the codebase:
- `BackgroundSyncStatus.tsx` already warns that Background Sync API is unsupported on Safari
- `useBackgroundSync.tsx` no-ops on iOS
- Service worker updates on iOS Safari require the PWA to be foregrounded; periodic sync doesn't run
- iOS aggressively evicts IndexedDB data from PWAs not opened in 7+ days

## Plan: Improve iPad/Safari sync + update reliability

### 1. Foreground sync trigger (replaces missing Background Sync)
`src/hooks/useAutoSync.tsx` — add visibility/focus listeners so sync runs whenever the PWA returns to foreground (iOS users open the app → immediate sync). Also poll on a 60s interval while visible+online, but only on iOS.

### 2. Foreground update check
`src/hooks/usePWAUpdate.tsx` — call `checkForUpdates()` on `visibilitychange` → visible, and on app focus. Critical on iOS where SW update checks otherwise never fire.

### 3. iOS-specific sync banner
Extend `BackgroundSyncStatus.tsx` to also show: "Keep this app open until the sync indicator turns green" with the live unsynced count from `usePWA()`. Mount it in the dashboard so iPad users see it.

### 4. Storage eviction warning for iOS
`src/lib/mobile-detection.ts` already detects iOS. Add a one-time prompt on iOS: "Add this app to your Home Screen to prevent data loss" — installed PWAs get persistent storage on iOS 16.4+.

### 5. Manual "Force sync now" prominence
Surface `ForceSyncButton` in the AuthenticatedHeader on iOS only, so iPad users always have a one-tap recovery.

### 6. Sync diagnostics panel
Add a small "Sync diagnostics" sheet (Profile page) showing: SW status, last update check, last sync, unsynced counts, IndexedDB quota, online/offline, isStandalone. Lets users self-diagnose without us guessing.

## Files to modify
- `src/hooks/useAutoSync.tsx` — visibility/focus triggers
- `src/hooks/usePWAUpdate.tsx` — foreground update check
- `src/components/pwa/BackgroundSyncStatus.tsx` — richer iOS guidance
- `src/components/AuthenticatedHeader.tsx` — surface ForceSyncButton on iOS
- `src/pages/Dashboard.tsx` — mount BackgroundSyncStatus
- `src/pages/Profile.tsx` — add Sync Diagnostics sheet (new component)
- New: `src/components/pwa/SyncDiagnosticsSheet.tsx`
- New: `src/components/pwa/IOSInstallPromptOnce.tsx` (one-time, dismissible)

## What this does NOT do
This will not change iOS, iCloud, or hardware. The user's stated steps (reset network settings, sign out of Apple ID, etc.) are device-level — outside the app. This plan fixes everything the app itself controls so the iPad has the best possible sync/update behavior within Safari's PWA constraints.

