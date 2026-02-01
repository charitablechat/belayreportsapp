
# Plan: Route ALL Toasts to Notification Center on Mobile

## Objective
Eliminate ALL toast overlays on mobile devices. Every toast (success, error, warning, info, loading) will be routed to the Notification Center instead of appearing as a visual popup.

---

## Technical Approach

### Strategy: Toast Interception at Source

Modify `src/components/ui/sonner.tsx` to export a mobile-aware `toast` object that routes all calls to the notification center on mobile, while maintaining normal desktop behavior.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/ui/sonner.tsx` | Export mobile-aware toast that routes ALL types to notification center |
| `src/lib/notification-center.ts` | Add `routeToastToNotification()` helper function |
| `src/components/ui/mobile-aware-toaster.tsx` | Conditionally hide Toaster on mobile entirely |

---

## Behavior Matrix

| Toast Type | Desktop | Mobile |
|------------|---------|--------|
| `toast.success()` | Shows toast | → Notification Center |
| `toast.error()` | Shows toast | → Notification Center |
| `toast.warning()` | Shows toast | → Notification Center |
| `toast.info()` | Shows toast | → Notification Center |
| `toast.loading()` | Shows toast | → Notification Center |
| `toast.promise()` | Shows toast | → Notification Center (loading/success/error states) |
| `toast.dismiss()` | Dismisses toast | No-op (nothing to dismiss) |

---

## Implementation Details

### 1. sonner.tsx - Complete Mobile Interception

```typescript
import { Toaster as Sonner, toast as sonnerToast, ExternalToast } from "sonner";
import { isMobile } from "@/lib/mobile-detection";
import { routeToastToNotification } from "@/lib/notification-center";

function createMobileAwareToast() {
  const checkMobile = () => isMobile();
  
  return {
    success: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'success');
        return null;
      }
      return sonnerToast.success(message, data);
    },
    error: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'error');
        return null;
      }
      return sonnerToast.error(message, data);
    },
    warning: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'warning');
        return null;
      }
      return sonnerToast.warning(message, data);
    },
    info: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'info');
        return null;
      }
      return sonnerToast.info(message, data);
    },
    loading: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'loading');
        return null;
      }
      return sonnerToast.loading(message, data);
    },
    promise: <T,>(promise: Promise<T>, messages: { loading: string; success: string; error: string }) => {
      if (checkMobile()) {
        routeToastToNotification(messages.loading, 'loading');
        promise
          .then(() => routeToastToNotification(messages.success, 'success'))
          .catch(() => routeToastToNotification(messages.error, 'error'));
        return promise;
      }
      return sonnerToast.promise(promise, messages);
    },
    dismiss: (id?: string | number) => {
      if (checkMobile()) return; // No-op on mobile
      return sonnerToast.dismiss(id);
    },
    // Default toast call
    message: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'info');
        return null;
      }
      return sonnerToast(message, data);
    },
    custom: sonnerToast.custom, // Keep custom for edge cases
  };
}

export const toast = createMobileAwareToast();
```

### 2. notification-center.ts - Add Routing Helper

```typescript
export type NotificationType = 'sync' | 'save' | 'error' | 'info' | 'loading';

/**
 * Route a toast message to the notification center
 * Maps toast types to notification types with appropriate priority
 */
export function routeToastToNotification(
  message: string, 
  type: 'success' | 'error' | 'warning' | 'info' | 'loading'
): void {
  switch (type) {
    case 'error':
      addErrorNotification(message);
      break;
    case 'success':
      // Categorize success messages
      if (/sync/i.test(message)) {
        addSyncNotification(message);
      } else {
        addSaveNotification(message);
      }
      break;
    case 'warning':
      addNotification('info', message, 'medium');
      break;
    case 'loading':
      addNotification('sync', message, 'low', 30000); // 30s expiry for loading
      break;
    case 'info':
    default:
      addNotification('info', message, 'low');
      break;
  }
}
```

### 3. mobile-aware-toaster.tsx - Hide on Mobile

```typescript
import { isMobile } from '@/lib/mobile-detection';
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

export function MobileAwareToaster() {
  // Don't render Toaster at all on mobile
  if (isMobile()) {
    return null;
  }
  return <ShadcnToaster />;
}

export function MobileAwareSonner() {
  // Don't render Sonner at all on mobile
  if (isMobile()) {
    return null;
  }
  return <SonnerToaster />;
}
```

---

## Why This Works

1. **Zero refactoring needed**: All 30+ files continue to import `toast` from `sonner` or `@/components/ui/sonner` - the interception happens transparently
2. **Complete coverage**: Every toast type is caught and routed
3. **Clean mobile UI**: No toast overlays ever appear on mobile
4. **Desktop unchanged**: Full toast experience preserved for desktop users
5. **Notification center becomes the single source**: Users check the notification center for all feedback

---

## User Experience on Mobile

- User performs action (save, sync, error occurs)
- StatusIndicator in header briefly pulses/updates
- Badge count increments on profile icon
- User can tap profile → Activity Log to see all notifications
- NO visual interruption during data entry

---

## Testing Checklist

- [ ] Trigger `toast.success()` on mobile → appears in notification center, NO overlay
- [ ] Trigger `toast.error()` on mobile → appears in notification center, NO overlay  
- [ ] Trigger `toast.loading()` on mobile → appears in notification center, NO overlay
- [ ] Test on desktop → all toasts appear normally as overlays
- [ ] Verify StatusIndicator updates when notifications arrive
- [ ] Verify Activity Log shows all routed notifications
