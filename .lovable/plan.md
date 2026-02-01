
# Plan: Version Display Mechanism

## Overview
Implement a version badge that displays consistently at the bottom of the Profile page on both desktop and mobile platforms.

---

## Technical Approach

### 1. Expose Version via Vite Config

**File:** `vite.config.ts`

Add a `define` option to expose the `package.json` version as an environment variable accessible via `import.meta.env.APP_VERSION`:

```typescript
export default defineConfig(({ mode }) => ({
  // ... existing config
  define: {
    'import.meta.env.APP_VERSION': JSON.stringify(
      require('./package.json').version
    )
  },
  // ... rest of config
}));
```

### 2. Add TypeScript Type Declaration

**File:** `src/vite-env.d.ts`

Extend the type definition to include the new environment variable:

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

### 3. Create Version Badge Component

**File:** `src/components/VersionBadge.tsx` (new file)

A reusable, non-interactive version badge:

```typescript
import { Badge } from "@/components/ui/badge";

export function VersionBadge() {
  const version = import.meta.env.APP_VERSION || '0.0.0';
  
  return (
    <div className="flex justify-center py-6">
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

Key styling choices:
- `variant="outline"`: Subtle, non-prominent appearance
- `text-xs font-mono`: Developer-focused monospace font, small size
- `text-muted-foreground/60`: 60% opacity for extra subtlety
- `border-muted-foreground/20`: Very faint border
- `py-6`: Adequate spacing from content above

### 4. Integrate into Profile Page

**File:** `src/pages/Profile.tsx`

Add the version badge at the very bottom of the `<main>` element, after the Data Sync card:

```tsx
import { VersionBadge } from "@/components/VersionBadge";

// ... existing code ...

        {/* Data Sync Section */}
        <Card className="mt-6">
          {/* ... existing Data Sync card content ... */}
        </Card>

        {/* Version Badge - Bottom of Profile */}
        <VersionBadge />
      </main>
    </div>
  );
}
```

---

## Visual Design

```text
┌─────────────────────────────────────┐
│          Profile Settings           │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐   │
│  │   Personal Information      │   │
│  │   ...                       │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │   Security                  │   │
│  │   ...                       │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │   Data Sync                 │   │
│  │   ...                       │   │
│  └─────────────────────────────┘   │
│                                     │
│            ┌─────────┐             │
│            │ v1.0.0  │             │
│            └─────────┘             │
│                                     │
└─────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `vite.config.ts` | Modify | Add `define` to expose version |
| `src/vite-env.d.ts` | Modify | Add TypeScript type for APP_VERSION |
| `src/components/VersionBadge.tsx` | **Create** | Reusable version badge component |
| `src/pages/Profile.tsx` | Modify | Import and render VersionBadge |

---

## Platform Behavior

| Platform | Rendering | Notes |
|----------|-----------|-------|
| Desktop | Centered badge below Data Sync card | Standard layout |
| Mobile | Same centered position | Respects mobile padding (`px-4`) via container |

The component is intentionally **platform-agnostic**—no conditional rendering needed since the Profile page layout is already responsive.

---

## Alternative Consideration: Footer Placement

If desired, the version could alternatively be placed in a persistent footer across all pages. However, the Profile page placement is:
- ✅ Non-intrusive (only visible when users actively check their profile)
- ✅ Consistent with "Settings" patterns in other applications
- ✅ Does not add visual noise to core workflows (Dashboard, Forms)

---

## Testing Checklist

After implementation:
- [ ] Version displays correctly on desktop Profile page
- [ ] Version displays correctly on mobile Profile page
- [ ] Badge styling is subtle and non-distracting
- [ ] Version string matches `package.json` version
- [ ] No layout overlap with Data Sync card or safe areas on mobile
