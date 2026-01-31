

# Fix: Photo Gallery Drag-and-Drop Not Working

## Issue Identified

The drag-and-drop functionality for photos is being disabled due to a **race condition** in the permission checking system:

1. When the Inspection Form loads, `inspectorId` is initially `null`
2. The `useReportEditPermission` hook returns `isReadOnly: true` when `inspectorId` is null or while still loading
3. This `isReadOnly` value is passed to `PhotoGallery` → `DraggablePhotoItem` as `disabled={true}`
4. Even after `inspectorId` is populated from offline/online data, the super admin check is still async
5. **Result**: The drag handle is disabled during the critical window when photos are already rendered

### Evidence from Code

```typescript
// src/hooks/useReportEditPermission.tsx (lines 84-92)
if (isLoading || !inspectorId) {
  return {
    canEdit: false,
    isReadOnly: true,  // ← Always read-only while loading!
    isOwner: false,
    // ...
  };
}
```

The photos load quickly from IndexedDB, but the permission check involves:
1. Waiting for `getUserWithCache()` 
2. Making an RPC call to `is_super_admin`
3. Setting state asynchronously

---

## Solution

Update the `useReportEditPermission` hook to **assume edit capability for the report owner during the loading state**. This is safe because:

- If the current user is NOT the owner, RLS policies already prevent data modification
- We can detect likely ownership by comparing the user ID with `inspectorId` early
- The worst case is briefly showing drag handles that don't function (better than hiding functionality from legitimate owners)

### Changes

#### File: `src/hooks/useReportEditPermission.tsx`

**Current Logic** (Problematic):
```typescript
// Default to read-only while loading
if (isLoading || !inspectorId) {
  return { isReadOnly: true, canEdit: false, ... };
}
```

**New Logic** (Fix):
```typescript
// If we have both inspectorId and currentUserId, we can determine ownership immediately
// without waiting for the super admin check to complete
if (inspectorId && currentUserId) {
  const isOwner = currentUserId === inspectorId;
  if (isOwner) {
    // Owner can always edit - don't need to wait for super admin check
    return {
      canEdit: true,
      isReadOnly: false,
      isOwner: true,
      isSuperAdmin,  // May still be loading, but irrelevant for owners
      isLoading: false,
      readOnlyReason: null
    };
  }
}

// Only default to read-only if we truly don't know ownership yet
if (isLoading && !currentUserId) {
  return { isReadOnly: true, ... };
}
```

This change allows report owners to interact with drag-and-drop immediately once:
1. The `inspectorId` is loaded from the inspection data
2. The `currentUserId` is retrieved from the cached auth

Both of these operations complete quickly (typically <100ms from cache), well before photos finish rendering.

---

## Technical Details

### Modified File

| File | Change |
|------|--------|
| `src/hooks/useReportEditPermission.tsx` | Optimize loading state to enable editing for owners immediately |

### Updated Permission Logic Flow

```text
┌─────────────────────────────────────────────────────────────┐
│                    Permission Check Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐                                        │
│  │ inspectorId &&  │──YES──► Owner can edit immediately!    │
│  │ currentUserId   │         (No need to wait for SA check) │
│  │ && match?       │                                        │
│  └────────┬────────┘                                        │
│           │ NO                                               │
│           ▼                                                  │
│  ┌─────────────────┐                                        │
│  │ Still loading   │──YES──► isReadOnly: true (safe default)│
│  │ user/inspector? │                                        │
│  └────────┬────────┘                                        │
│           │ NO (loaded)                                      │
│           ▼                                                  │
│  ┌─────────────────┐                                        │
│  │ Is Super Admin? │──YES──► isReadOnly: true (view only)   │
│  └────────┬────────┘                                        │
│           │ NO                                               │
│           ▼                                                  │
│       Not owner + Not SA = No access (RLS enforced)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Expected Outcome

After this fix:

1. Report owners will be able to drag and drop photos immediately upon page load
2. Super Admins will still see the gallery in read-only mode (no drag handles)
3. The loading state no longer blocks legitimate owner interactions
4. No security implications - RLS policies still enforce server-side restrictions

---

## Testing Verification

After implementation, verify:

1. Open an inspection report you own
2. Scroll to the Photos section
3. Touch and hold the grip handle (mobile) or click and drag (desktop)
4. Confirm photos can be reordered with smooth animations
5. Confirm the new order persists after page reload
6. Test as Super Admin viewing another user's report - drag handles should NOT appear

