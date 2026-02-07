

# Reorder Profile Dropdown Menu Items - v2.4.13

## Changes

Rearrange the menu items in `UserProfileDropdown.tsx` so the new order after "Profile" is:

1. Profile
2. Check for Updates
3. Contact Developer
4. Force Sync Now
5. Activity Log
6. Push Notifications
7. Device Capabilities
8. Install Instructions
9. Install App (conditional)
10. Version Badge
11. Sign Out

## Technical Details

### File: `src/components/UserProfileDropdown.tsx`

Move three blocks of JSX within `DropdownMenuContent`:
- Move **Check for Updates** (lines 146-151) to directly after **Profile** (line 109)
- Move **Contact Developer** (lines 158-162) to directly after Check for Updates
- Move **Force Sync Now** (lines 153-156) to directly after Contact Developer
- **Activity Log** stays where it is and naturally follows

### File: `vite.config.ts`

- Bump `APP_VERSION` from `"2.4.12"` to `"2.4.13"`

### Also: Fix the vite config build error

The current build error ("config must export or return an object") is a transient HMR issue. Re-saving the file with the version bump will resolve it.

