
# Clean Up Profile Dropdown -- Group Utility Items

## Overview

Tidy the dropdown by grouping the four utility/info items under a "System & Device" section label. Everything remains visible at once with no sub-menus. Light styling touch to keep it clean -- no dramatic aesthetic overhaul.

## Changes to `src/components/UserProfileDropdown.tsx`

### Add a section header before the utility items

Insert a `DropdownMenuSeparator` and a `DropdownMenuLabel` with the text "System & Device" (small, muted, uppercase) right before the Activity Log item (line 131). Then another separator after Install Instructions / Install App (before the Version Badge).

This visually groups: Activity Log, Push Notifications, Device Capabilities, Install Instructions (and the conditional Install App) under one heading.

### Add a missing icon to Device Capabilities

Currently the "Device Capabilities" item has no icon. Add a `Monitor` (or `Smartphone`) icon from lucide-react for consistency with the other items.

### Menu order (unchanged)

1. Account header + email
2. Admin Dashboard (if super admin)
3. Profile
4. Check for Updates
5. Contact Developer
6. Force Sync Now
7. **--- separator ---**
8. **"System & Device" label**
9. Activity Log
10. Push Notifications
11. Device Capabilities
12. Install Instructions
13. Install App (conditional)
14. **--- separator ---**
15. Version Badge
16. Sign Out

### Technical detail

- Section label styling: `text-[11px] uppercase tracking-wider text-muted-foreground font-medium` on a `DropdownMenuLabel`
- Import `Monitor` (or `Smartphone`) from lucide-react for the Device Capabilities icon
- No logic, navigation, or functionality changes whatsoever
- Only file modified: `src/components/UserProfileDropdown.tsx`
