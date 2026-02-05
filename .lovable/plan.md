

# Plan: Unify Profile Dropdown Menu Across All Pages (v2.2.98)

## ✅ IMPLEMENTED - v2.2.98

The unified `UserProfileDropdown` component has been created and integrated into all pages.

## Problem Summary

The profile dropdown menu currently shows different options depending on which page the user is on:

| Page | Menu Items |
|------|-----------|
| **Dashboard** | Admin Dashboard, Profile, Activity Log, Push Notifications, Device Capabilities, Install Instructions, Install App, Check for Updates, Force Sync Now, Contact Developer, Version Badge, Sign Out |
| **InspectionForm** | Profile, Sign Out |
| **TrainingForm** | Profile, Sign Out |
| **DailyAssessmentForm** | Profile, Sign Out |

**User Expectation**: All actions should be available from the profile dropdown on every page where the profile icon appears.

---

## Solution

Create a **shared `UserProfileDropdown` component** that contains all profile menu items, then replace the inline dropdown code in each page with this component.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/UserProfileDropdown.tsx` | **Create** | New shared component containing all profile menu items |
| `src/pages/Dashboard.tsx` | **Modify** | Replace inline dropdown with shared component |
| `src/pages/InspectionForm.tsx` | **Modify** | Replace minimal dropdown with shared component |
| `src/pages/TrainingForm.tsx` | **Modify** | Replace minimal dropdown with shared component |
| `src/pages/DailyAssessmentForm.tsx` | **Modify** | Replace minimal dropdown with shared component |
| `vite.config.ts` | **Modify** | Version bump to 2.2.98 |

---

## Implementation Details

### 1. Create UserProfileDropdown Component

A new component that encapsulates all profile dropdown functionality:

```typescript
// src/components/UserProfileDropdown.tsx
interface UserProfileDropdownProps {
  currentUser: { email?: string } | null;
  userProfile: { avatar_url?: string } | null;
  isSuperAdmin?: boolean;
  onSignOut: () => void;
  signingOut?: boolean;
}
```

**Features included:**
- Account header with email and Super Admin badge (if applicable)
- Admin Dashboard link (Super Admins only)
- Profile navigation
- Activity Log (NotificationCenter)
- Push Notifications dialog trigger
- Device Capabilities navigation
- Install Instructions navigation
- Install App button (if installable and not installed)
- Check for Updates (ManualUpdateButton)
- Force Sync Now
- Contact Developer
- Version Badge
- Sign Out

**State Management:**
- The component will accept callbacks and state from the parent
- Internal state for dialogs (Push Notifications, Contact Developer) will be managed within the component
- PWA state (isInstallable, isInstalled, promptInstall) will be accessed via usePWAInstall hook

### 2. Dashboard.tsx Changes

Replace ~100 lines of inline dropdown code with:

```tsx
<UserProfileDropdown
  currentUser={currentUser}
  userProfile={userProfile}
  isSuperAdmin={isSuperAdmin}
  onSignOut={handleSignOut}
  signingOut={signingOut}
/>
```

### 3. InspectionForm.tsx Changes

Replace the minimal dropdown (lines 1800-1826) with the shared component.

**Required additions:**
- Import `UserProfileDropdown`
- Add super admin check query (copy pattern from Dashboard)
- Add `signingOut` state
- Add `handleSignOut` function (already exists but may need adjustment)

### 4. TrainingForm.tsx Changes

Same pattern as InspectionForm - replace minimal dropdown with shared component.

### 5. DailyAssessmentForm.tsx Changes

Same pattern as InspectionForm - replace minimal dropdown with shared component.

---

## Component Props Design

```typescript
interface UserProfileDropdownProps {
  // User info for display
  currentUser: { email?: string; id?: string } | null;
  userProfile: { avatar_url?: string } | null;
  
  // Admin status
  isSuperAdmin?: boolean;
  
  // Sign out handling
  onSignOut: () => void;
  signingOut?: boolean;
}
```

**Internal hooks used:**
- `usePWAInstall()` - for install button state
- `useNavigate()` - for navigation
- Internal state for dialogs

---

## Technical Considerations

1. **Super Admin Check**: Each form page will need to add the super admin query to show/hide the Admin Dashboard option
2. **Dialog State**: Push Notifications and Contact Developer dialogs will be managed inside the dropdown component
3. **No Functional Changes**: Only the location of menu items changes; the logic remains identical
4. **Consistent Styling**: The dropdown uses the same `w-56` width and styling across all pages

---

## Menu Item Order (Consistent Across All Pages)

1. Account Header (with Super Admin badge if applicable)
2. Separator
3. Admin Dashboard (Super Admins only)
4. Separator (Super Admins only)
5. Profile
6. Activity Log
7. Push Notifications
8. Device Capabilities
9. Install Instructions
10. Install App (if applicable)
11. Check for Updates
12. Force Sync Now
13. Contact Developer
14. Version Badge
15. Separator
16. Sign Out

---

## Testing Checklist

1. **Dashboard** - Verify dropdown still works with all items
2. **InspectionForm** - Verify all menu items now appear
3. **TrainingForm** - Verify all menu items now appear
4. **DailyAssessmentForm** - Verify all menu items now appear
5. **Super Admin badge** - Verify it appears correctly on all pages for admins
6. **Admin Dashboard link** - Verify it only appears for super admins
7. **Install App** - Verify it only appears when installable
8. **Force Sync** - Verify it works from any page
9. **Contact Developer** - Verify sheet opens from any page
10. **Sign Out** - Verify sign out works from any page

