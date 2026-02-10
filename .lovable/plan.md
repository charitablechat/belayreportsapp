
# Move System & Device Items into a Nested Submenu

## Overview

Collapse the four "System & Device" items (Activity Log, Push Notifications, Device Capabilities, Install Instructions) into a single compact row with a nested dropdown, mirroring the existing "Check for Updates" pattern -- a label/button on the left and a `MoreVertical` (ellipsis) icon on the right that opens the sub-items.

## Changes to `src/components/UserProfileDropdown.tsx`

### Replace the expanded section with a compact submenu row

**Remove** (lines 131-170): The separator, "System & Device" label, and the four individual menu items (Activity Log, Push Notifications, Device Capabilities, Install Instructions, plus conditional Install App).

**Insert** in their place: A single `DropdownMenuItem`-styled row containing:
- A `Monitor` icon and "System & Device" label on the left
- A nested `DropdownMenu` with a `MoreVertical` trigger button on the right

The nested dropdown content will contain the four items (Activity Log, Push Notifications, Device Capabilities, Install Instructions) plus the conditional Install App item, preserving all existing `onClick` handlers and icon usage exactly as-is.

### Structure

```text
Before:
  Force Sync Now
  ─────────────
  SYSTEM & DEVICE        (section label)
  Activity Log
  Push Notifications
  Device Capabilities
  Install Instructions
  Install App (conditional)
  ─────────────

After:
  Force Sync Now
  ─────────────
  [Monitor] System & Device    [...]   <-- single row, ellipsis opens submenu
  ─────────────
```

### Implementation detail

```tsx
<DropdownMenuSeparator />
<div className="flex items-center justify-between px-2 py-1.5">
  <span className="flex items-center text-sm text-muted-foreground">
    <Monitor className="w-4 h-4 mr-2" />
    System & Device
  </span>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
        <MoreVertical className="w-4 h-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" side="left">
      {/* Activity Log -- NotificationCenter with trigger */}
      {/* Push Notifications -- opens dialog */}
      {/* Device Capabilities -- navigates to /capabilities */}
      {/* Install Instructions -- navigates to /install */}
      {/* Install App -- conditional */}
    </DropdownMenuContent>
  </DropdownMenu>
</div>
<DropdownMenuSeparator />
```

### Import change

Add `MoreVertical` to the lucide-react import (line 13).

## What Does NOT Change

- All onClick handlers, navigation targets, and dialog/sheet triggers remain identical
- NotificationCenter still uses its Sheet-based trigger pattern
- PushNotificationManager Dialog behavior unchanged
- Conditional Install App rendering logic unchanged
- No data fetching, security, or routing logic affected
- Version Badge, Sign Out, and all other menu items stay as-is
- Only file modified: `src/components/UserProfileDropdown.tsx`
