

# Version Info Modal Implementation

## Overview

Transform the existing `VersionBadge` component into an interactive element that opens a brutalist-styled modal displaying detailed version and deployment information.

## Design Specification

### Brutalist Modal Aesthetic
- **Background**: Pure black (#000000)
- **Primary text**: White (#FFFFFF) for version number
- **Secondary text**: Amber (#F59E0B) for labels and timestamps
- **Border**: 2px solid white, sharp corners (no border-radius)
- **No shadows**: Zero elevation effects
- **Typography**: Monospace font throughout for developer aesthetic
- **Close button**: Stark 'X' icon in top-right, white on black

### Modal Content Layout
```
┌─────────────────────────────────────────┐
│ VERSION INFO                        [X] │
├─────────────────────────────────────────┤
│                                         │
│           v2.2.20                       │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  LAST UPDATE                            │
│  2024-05-20                             │
│                                         │
│  BUILD TIMESTAMP                        │
│  2024-05-20T14:30:00Z                   │
│                                         │
└─────────────────────────────────────────┘
```

## Technical Implementation

### Version Constants (vite.config.ts)

Add build metadata alongside the version number:

```typescript
const APP_VERSION = "2.2.20";
const BUILD_DATE = "2024-05-20";
const BUILD_TIMESTAMP = "2024-05-20T14:30:00Z";
```

These will be exposed via `import.meta.env` for access in the component.

### New Component: VersionInfoModal

Create a dedicated modal component with brutalist styling that:
1. Uses Radix Dialog primitives for accessibility (keyboard navigation, focus trap)
2. Overrides default dialog styling with brutalist aesthetic
3. Dismisses on Escape key (built-in to Radix) and X button click

### Updated VersionBadge Component

Modify to:
1. Accept tap/click interactions via `onClick` handler
2. Add `cursor-pointer` and hover state for affordance
3. Open the VersionInfoModal when activated
4. Work identically on touch (mobile) and pointer (web) devices

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `vite.config.ts` | Modify | Add BUILD_DATE and BUILD_TIMESTAMP constants |
| `src/vite-env.d.ts` | Modify | Add type declarations for new env variables |
| `src/components/VersionInfoModal.tsx` | Create | Brutalist modal component |
| `src/components/VersionBadge.tsx` | Modify | Add click handler and modal trigger |

## Detailed Changes

### 1. vite.config.ts

```typescript
// Version follows vX.Y.Z format where Z increments by 10 on each deployment
// v2.2.20 - Added interactive version info modal with deployment metadata
const APP_VERSION = "2.2.20";
const BUILD_DATE = "2024-05-20";
const BUILD_TIMESTAMP = "2024-05-20T14:30:00Z";

export default defineConfig(({ mode }) => ({
  // ...existing config
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(APP_VERSION),
    'import.meta.env.BUILD_DATE': JSON.stringify(BUILD_DATE),
    'import.meta.env.BUILD_TIMESTAMP': JSON.stringify(BUILD_TIMESTAMP),
  },
  // ...
}));
```

### 2. src/vite-env.d.ts

```typescript
interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly BUILD_DATE: string;
  readonly BUILD_TIMESTAMP: string;
}
```

### 3. src/components/VersionInfoModal.tsx (NEW)

```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { X } from "lucide-react";

interface VersionInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionInfoModal({ open, onOpenChange }: VersionInfoModalProps) {
  const version = import.meta.env.APP_VERSION || '0.0.0';
  const buildDate = import.meta.env.BUILD_DATE || 'Unknown';
  const buildTimestamp = import.meta.env.BUILD_TIMESTAMP || 'Unknown';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        hideDefaultClose
        className="bg-black border-2 border-white rounded-none shadow-none max-w-sm"
      >
        {/* Custom brutalist close button */}
        <DialogClose className="absolute right-3 top-3 p-1 border border-white/50 hover:border-white hover:bg-white/10 transition-colors">
          <X className="h-4 w-4 text-white" />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader>
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-amber-500">
            Version Info
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Version Number - Hero Display */}
          <div className="text-center py-4">
            <span className="font-mono text-4xl font-bold text-white tracking-tight">
              v{version}
            </span>
          </div>

          <div className="border-t border-white/20" />

          {/* Last Update Date */}
          <div className="space-y-1">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500 block">
              Last Update
            </span>
            <span className="font-mono text-sm text-white block">
              {buildDate}
            </span>
          </div>

          {/* Build Timestamp */}
          <div className="space-y-1">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500 block">
              Build Timestamp
            </span>
            <span className="font-mono text-sm text-white block">
              {buildTimestamp}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 4. src/components/VersionBadge.tsx (UPDATE)

```typescript
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { VersionInfoModal } from "@/components/VersionInfoModal";

interface VersionBadgeProps {
  compact?: boolean;
}

export function VersionBadge({ compact = false }: VersionBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const version = import.meta.env.APP_VERSION || '0.0.0';
  
  return (
    <>
      <div className={compact ? "flex justify-center py-2" : "flex justify-center py-6"}>
        <Badge 
          variant="outline" 
          className="text-xs font-mono text-muted-foreground/60 border-muted-foreground/20 px-3 py-1 cursor-pointer hover:text-muted-foreground hover:border-muted-foreground/40 transition-colors"
          onClick={() => setModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setModalOpen(true);
            }
          }}
        >
          v{version}
        </Badge>
      </div>

      <VersionInfoModal 
        open={modalOpen} 
        onOpenChange={setModalOpen} 
      />
    </>
  );
}
```

## Platform Compatibility

### Web (Desktop)
- Click event triggers modal open
- Keyboard navigation: Tab to focus, Enter/Space to activate
- Escape key closes modal
- X button click closes modal

### Mobile (iOS/Android PWA)
- Touch/tap event triggers modal open (React normalizes click events)
- Radix Dialog handles touch interactions automatically
- Modal backdrop tap-to-dismiss (built into Radix)

## Accessibility Features

- `role="button"` and `tabIndex={0}` for keyboard navigation
- `onKeyDown` handler for Enter/Space activation
- Screen reader announces "Close" for the X button
- Focus trap within modal when open
- Escape key dismissal

## Version Increment

This feature update will increment the version to **v2.2.20** (patch +10 from current v2.2.10).

