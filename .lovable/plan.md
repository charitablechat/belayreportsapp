
# Plan: Add Version Badge to Dashboard Dropdown Menu

## Overview
Move the version display from the Profile page to the Dashboard's user dropdown menu, positioning it directly below the "Contact Developer" item.

---

## Technical Approach

### 1. Update VersionBadge Component for Dropdown Context

**File:** `src/components/VersionBadge.tsx`

Add an optional `compact` prop to support both the Profile page placement (with padding) and the dropdown menu placement (minimal padding):

```typescript
import { Badge } from "@/components/ui/badge";

interface VersionBadgeProps {
  compact?: boolean;
}

export function VersionBadge({ compact = false }: VersionBadgeProps) {
  const version = import.meta.env.APP_VERSION || '0.0.0';
  
  return (
    <div className={compact ? "flex justify-center py-2" : "flex justify-center py-6"}>
      <Badge 
        variant="outline" 
        className="text-xs font-mono text-muted-foreground/60 border-muted-foreground/20 px-3 py-1"
      >
        v{version}
      </Badge>
    </div>
  );
}
```

### 2. Add VersionBadge to Dashboard Dropdown

**File:** `src/pages/Dashboard.tsx`

Import the VersionBadge component and add it to the dropdown menu between "Contact Developer" and the separator:

**Import (near top of file):**
```typescript
import { VersionBadge } from "@/components/VersionBadge";
```

**Placement (after line 783):**
```tsx
<DropdownMenuItem onClick={() => setContactSheetOpen(true)}>
  <MessageCircle className="w-4 h-4 mr-2" />
  Contact Developer
</DropdownMenuItem>

{/* Version Badge - Below Contact Developer */}
<div className="px-2 py-1.5">
  <VersionBadge compact />
</div>

<DropdownMenuSeparator />
```

### 3. Update Profile.tsx to Use Non-Compact Version

**File:** `src/pages/Profile.tsx`

No change needed - the default `compact={false}` will preserve the existing Profile page styling.

---

## Visual Design

**Before:**
```text
┌─────────────────────────┐
│ ...                     │
│ Force Sync Now          │
│ Contact Developer       │
│ ─────────────────────── │
│ Sign Out                │
└─────────────────────────┘
```

**After:**
```text
┌─────────────────────────┐
│ ...                     │
│ Force Sync Now          │
│ Contact Developer       │
│       ┌─────────┐       │
│       │ v1.0.0  │       │
│       └─────────┘       │
│ ─────────────────────── │
│ Sign Out                │
└─────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/VersionBadge.tsx` | Add `compact` prop for dropdown styling |
| `src/pages/Dashboard.tsx` | Import and render VersionBadge in dropdown menu |

---

## Testing Checklist

After implementation:
- [ ] Version badge appears below "Contact Developer" in the dropdown menu
- [ ] Badge is centered and uses subtle styling (muted gray, monospace)
- [ ] Version string matches `package.json` version
- [ ] Profile page version badge still displays correctly with full padding
- [ ] Dropdown menu layout is not disrupted on mobile or desktop
