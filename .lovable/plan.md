
# Refactor Notification System: Minimize Distraction with Developer-Focused Notification Center

## Current State Analysis

### Architecture Overview
The application has a multi-layered notification system:

1. **Sonner Toast Wrapper** (`src/components/ui/sonner.tsx`)
   - Creates `toast` object that wraps sonner's toast functions
   - Uses `isCriticalMessage()` to determine if a toast should show on mobile
   - Routes non-critical mobile toasts to the notification center

2. **Notification Center Library** (`src/lib/notification-center.ts`)
   - In-memory store for `StatusNotification` objects
   - Aggregates notifications with debouncing for sync/save messages
   - Types: `sync`, `save`, `error`, `info`, `loading`
   - Priority levels: `low`, `medium`, `high`

3. **Notification Center Component** (`src/components/pwa/NotificationCenter.tsx`)
   - Sheet-based UI accessible from Dashboard dropdown menu
   - Shows notification history with icons and timestamps

4. **StatusIndicator** (`src/components/pwa/StatusIndicator.tsx`)
   - Subtle header indicator for sync/save status on mobile

### Current Problems

1. **Desktop shows ALL toasts** - No filtering, every success/info/warning shows as overlay
2. **"Critical" is too broad** - Currently includes all sync messages, even routine "Data synced successfully"
3. **isCriticalMessage regex is too inclusive** - Matches `sync|syncing|synced` which catches routine operations
4. **Toast duration is 60 seconds** - Excessive for routine notifications
5. **Notification center lacks visual hierarchy** - No clear status badges (INFO, WARNING, SUCCESS, ERROR)

## Solution Design

### Phase 1: Redefine Criticality Logic

**New Criticality Classification:**

| Critical (Toast) | Non-Critical (Center Only) |
|------------------|---------------------------|
| Authentication failures | Routine sync complete |
| Network disconnection/reconnection | Settings saved |
| System errors requiring action | Profile updated |
| PWA update available | Auto-save success |
| Major transaction failures | Background task complete |
| First-time user onboarding messages | Minor validation messages |

**Implementation:** Create a centralized `CriticalityConfig` that can be easily modified:

```typescript
// New file: src/lib/notification-config.ts

export type CriticalityLevel = 'critical' | 'standard' | 'silent';

export interface NotificationConfig {
  patterns: {
    critical: RegExp[];     // Always show as toast
    silent: RegExp[];       // Never show toast, only center
    // Everything else = 'standard' (desktop toast, mobile center)
  };
  durations: {
    critical: number;       // 10000ms
    standard: number;       // 4000ms
    error: number;          // 8000ms
  };
}

export const NOTIFICATION_CONFIG: NotificationConfig = {
  patterns: {
    critical: [
      /error|fail|denied|unauthorized/i,
      /offline|reconnect|connection lost/i,
      /update available|new version/i,
      /session expired|please sign in/i,
    ],
    silent: [
      /saved|settings updated|profile updated/i,
      /synced successfully$/i,      // Routine sync complete
      /changes saved/i,
      /auto-?save/i,
    ],
  },
  durations: {
    critical: 10000,
    standard: 4000,
    error: 8000,
  },
};
```

### Phase 2: Unified Toast Wrapper

Update `src/components/ui/sonner.tsx` to apply filtering on **all platforms** (not just mobile):

```typescript
function getCriticalityLevel(message: string, type: ToastType): CriticalityLevel {
  const { patterns } = NOTIFICATION_CONFIG;
  
  // Errors are always critical
  if (type === 'error') return 'critical';
  
  // Check critical patterns
  if (patterns.critical.some(p => p.test(message))) return 'critical';
  
  // Check silent patterns
  if (patterns.silent.some(p => p.test(message))) return 'silent';
  
  // Default behavior
  return 'standard';
}

// Updated toast wrapper behavior:
// - 'critical': Always show toast (all platforms)
// - 'standard': Show toast on desktop, route to center on mobile
// - 'silent': Route to center only (all platforms)
```

### Phase 3: Developer-Focused Notification Center Redesign

Redesign the `NotificationCenter` component with clear status badges:

```text
┌────────────────────────────────────────────┐
│ 🔔 Activity Log                    Clear ▿ │
├────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐ │
│ │ [ERROR] Sync failed: Network timeout   │ │
│ │ 2 minutes ago                          │ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ [SUCCESS] Data synced (3 items)        │ │
│ │ 5 minutes ago                          │ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ [INFO] Settings saved                  │ │
│ │ 12 minutes ago                         │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

**Visual Badge Styling:**

| Badge     | Background    | Text Color  | Icon        |
|-----------|---------------|-------------|-------------|
| ERROR     | `destructive` | White       | AlertCircle |
| WARNING   | `amber-500`   | White       | AlertTriangle |
| SUCCESS   | `green-600`   | White       | CheckCircle |
| INFO      | `muted`       | Foreground  | Info        |
| SYNC      | `blue-500`    | White       | Cloud       |

### Phase 4: Add Notification Type to Interface

Extend `NotificationType` to include a display category for badges:

```typescript
// Updated notification-center.ts
export type NotificationCategory = 'ERROR' | 'WARNING' | 'SUCCESS' | 'INFO' | 'SYNC';

export interface StatusNotification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;  // NEW: For badge display
  message: string;
  timestamp: number;
  priority: NotificationPriority;
  read: boolean;
  expiresAt?: number;
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/notification-config.ts` | **NEW** - Centralized criticality configuration |
| `src/lib/notification-center.ts` | Add `category` to notifications, update routing |
| `src/components/ui/sonner.tsx` | Apply universal criticality filtering |
| `src/components/pwa/NotificationCenter.tsx` | Developer-style badges, cleaner UI |
| `src/hooks/useNotificationCenter.tsx` | Support new category field |
| `vite.config.ts` | Version bump to v2.2.70 |

## Technical Implementation Details

### 1. New File: `src/lib/notification-config.ts`

Creates centralized, easily configurable criticality rules with:
- Pattern-based matching for critical/silent classification
- Duration settings per criticality level
- Export function `classifyMessage(message, type)` returning criticality level

### 2. Update: `src/lib/notification-center.ts`

- Add `category: NotificationCategory` to `StatusNotification` interface
- Update `addNotification()` to derive category from type
- Add `addNotificationWithCategory()` helper for explicit category assignment
- Update `routeToastToNotification()` to set appropriate category

### 3. Update: `src/components/ui/sonner.tsx`

- Import `NOTIFICATION_CONFIG` and `classifyMessage()`
- Replace `isCriticalMessage()` with new criticality classification
- Apply filtering to desktop too (silent messages → center only)
- Adjust toast durations based on criticality level
- Keep `isMobile()` check for standard messages (toast on desktop, center on mobile)

### 4. Update: `src/components/pwa/NotificationCenter.tsx`

- Add `NotificationBadge` component with styled badges
- Map notification types to categories for display
- Cleaner typography with monospace timestamps
- Group notifications by time (Today, Yesterday, Older)
- Add filter dropdown (All, Errors, Sync, Saves)

### 5. Update: `vite.config.ts`

```typescript
const APP_VERSION = "2.2.70";
const BUILD_TIMESTAMP = "02-04-2026 at 12:00 PM CST";
```

## Expected Behavior After Implementation

| Scenario | Desktop | Mobile |
|----------|---------|--------|
| "Failed to sync" (error) | Toast | Toast + Center |
| "Data synced successfully" | Center only | Center only |
| "Settings saved" | Center only | Center only |
| "Network reconnected" | Toast | Toast + Center |
| "Update available" | Toast | Toast + Center |
| "Profile updated" | Center only | Center only |

## Testing Checklist

1. Verify critical errors show as toasts on both platforms
2. Verify routine "saved" messages go to center only
3. Verify sync success messages go to center only
4. Verify network status changes show as toasts
5. Verify notification center displays proper badges
6. Verify unread count updates correctly
7. Verify "Mark all read" works
8. Verify notifications expire after configured time
