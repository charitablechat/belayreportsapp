

# Fix Photo Buttons Missing When Offline

## Problem
When the device goes offline (airplane mode), the "Take Photo" and "Upload" buttons disappear from all photo sections in the Inspection Form. They reappear when back online. The root cause is in the `useReportEditPermission` hook.

## Root Cause
The `useReportEditPermission` hook calls `getUserWithCache()` to determine `currentUserId`. When offline with an expired session token, this can return `null` on some devices (e.g., if `navigator.onLine` briefly reports `true` during airplane mode transitions, causing the expiry check to reject the cached token). When `currentUserId` is `null`, the hook returns `isReadOnly: true` (line 98), which hides the `PhotoCapture` buttons via `{!effectiveReadOnly && <PhotoCapture />}`.

## Fix

**File: `src/hooks/useReportEditPermission.tsx`**

Add an offline fallback using `getOfflineUserId()` (already used elsewhere in the app for this exact scenario). If `getUserWithCache()` returns null, fall back to extracting the user ID directly from localStorage, bypassing token expiry checks entirely.

```typescript
import { getUserWithCache, getSuperAdminStatusWithCache, getOfflineUserId } from "@/lib/cached-auth";

// In checkPermissions():
const user = await getUserWithCache();
const userId = user?.id ?? getOfflineUserId(); // Offline fallback
setCurrentUserId(userId ?? null);
```

This matches the existing "offline auth hardening" pattern already used in `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx` form components.

## Impact
- CSS/layout: No changes
- Data persistence: No changes -- this only affects the read-only flag that controls button visibility
- All three form types (Inspection, Training, Daily Assessment) use this same hook, so the fix applies everywhere
- The `getOfflineUserId()` function already exists and is battle-tested for offline scenarios

