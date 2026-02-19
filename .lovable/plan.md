

# Global Persistent User Profile Dropdown

## Problem
The `UserProfileDropdown` is currently duplicated across 4 pages (Dashboard, InspectionForm, TrainingForm, DailyAssessmentForm), each managing its own `currentUser`, `userProfile`, `isSuperAdmin`, and `signingOut` state independently. Some pages (Profile, SuperAdminDashboard, Install, Capabilities) don't have it at all.

## Solution
Create a global layout component that provides the user profile dropdown on every authenticated page, eliminating duplicated auth/profile state and ensuring consistent access to all user actions.

## Architecture

**Approach: Auth-aware Layout wrapper in `RootLayout`**

Rather than adding a React Context (overkill for this), the cleanest approach is:

1. Create an `AuthenticatedHeader` component that self-manages its auth state using existing hooks/utilities
2. Render it inside the existing `RootLayout` in `App.tsx`  
3. Only show it on authenticated routes (hide on `/`, `/welcome`)
4. Remove the duplicated `UserProfileDropdown` usage from individual pages

## What Changes

### 1. New file: `src/components/AuthenticatedHeader.tsx`
A self-contained header component that:
- Fetches `currentUser` via `getUserWithCache()`
- Fetches `userProfile` from the `profiles` table
- Checks `isSuperAdmin` via `user_roles` query (with localStorage cache for offline)
- Manages `signingOut` state
- Renders the `UserProfileDropdown` in a fixed/sticky position (top-right)
- Includes ARIA labels on the trigger button
- Returns `null` on unauthenticated routes (`/`, `/welcome`)
- Responsive: consistent positioning across all viewports

### 2. Edit: `src/App.tsx`
- Import and render `AuthenticatedHeader` inside `RootLayout`, above `<Outlet />`
- The header persists across route changes without re-mounting since `RootLayout` is the parent of all routes

### 3. Edit: `src/pages/Dashboard.tsx`
- Remove the `UserProfileDropdown` import and usage from the header section
- Remove `currentUser`, `userProfile`, `signingOut`, `handleSignOut` state that was only used for the dropdown (keep any state used elsewhere in the page)
- Keep the page-specific header content (logos, sync buttons, badges) but remove the dropdown from it

### 4. Edit: `src/pages/InspectionForm.tsx`
- Remove `UserProfileDropdown` import and usage
- Remove `signingOut`/`handleSignOut` state (the `currentUser` and `currentUserProfile` state are still used for form logic, so those stay)

### 5. Edit: `src/pages/TrainingForm.tsx`
- Same cleanup as InspectionForm

### 6. Edit: `src/pages/DailyAssessmentForm.tsx`
- Same cleanup as InspectionForm

## Permission-Based Rendering
The dropdown already handles permissions dynamically:
- **Admin Dashboard** menu item: only shown when `isSuperAdmin === true`
- **Install App** option: only shown when `isInstallable && !isInstalled`
- **Sign Out**: always available when authenticated
- The entire header is hidden on public routes (`/`, `/welcome`)

No changes needed to this logic -- it already works correctly inside `UserProfileDropdown`.

## Technical Details

### AuthenticatedHeader positioning
The component will render as a fixed-position element (top-right corner) with a high `z-index` so it floats above page content on all routes. This avoids needing to modify each page's header layout. Pages that already have their own headers (Dashboard with logos, form pages with back buttons) keep their layout -- the profile dropdown just appears consistently in the top-right.

### State management
- Uses `useQuery` for `isSuperAdmin` (same pattern as Dashboard) with `staleTime: 2min` and localStorage placeholder
- Uses `useState` + `useEffect` for `currentUser` and `userProfile` via `getUserWithCache()`
- Listens to `onAuthStateChange` to react to sign-in/sign-out events
- No global context needed -- the component is a singleton rendered once in `RootLayout`

### Files modified

| File | Change |
|------|--------|
| `src/components/AuthenticatedHeader.tsx` | **New** -- self-contained auth-aware header with `UserProfileDropdown` |
| `src/App.tsx` | Import + render `AuthenticatedHeader` in `RootLayout` |
| `src/pages/Dashboard.tsx` | Remove `UserProfileDropdown` usage and related sign-out state |
| `src/pages/InspectionForm.tsx` | Remove `UserProfileDropdown` usage and `signingOut`/`handleSignOut` |
| `src/pages/TrainingForm.tsx` | Same cleanup |
| `src/pages/DailyAssessmentForm.tsx` | Same cleanup |

