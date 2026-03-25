

## Add Letters Inside Refresh & Sync Icons

### Changes

**File: `src/pages/Dashboard.tsx` (~line 1090)**
Replace the plain `RefreshCw` icon in the Refresh button with a `relative` wrapper containing the icon and an absolutely-positioned "R" letter centered inside:
```tsx
<span className="relative inline-flex items-center justify-center">
  <RefreshCw className={cn("h-4 w-4", refreshInFlightRef.current && "animate-spin")} />
  <span className="absolute text-[7px] font-bold leading-none">R</span>
</span>
```

**File: `src/components/pwa/ForceSyncButton.tsx`**
Apply the same pattern to all three variants (icon, menu-item, default), placing an "S" centered inside each `RefreshCw` icon:
- **Icon variant** (~line 91): Wrap in relative span, add "S" at `text-[8px]` (slightly larger since icon is `h-5 w-5`)
- **Menu-item variant** (~line 115): Same pattern with `text-[7px]`
- **Default variant** (~line 139): Same pattern with `text-[7px]`

### Files

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Wrap Refresh icon with centered "R" letter |
| `src/components/pwa/ForceSyncButton.tsx` | Wrap all 3 Sync icons with centered "S" letter |

