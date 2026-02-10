

# Redesign Sync Status Indicators -- Non-Intrusive Kinetic Minimalism

## Problem

The current sync feedback causes visual disruption:
1. A large "Pending Sync" warning banner on the Dashboard pushes content down and uses an animated spinner
2. The header `SyncStatusIndicator` badge jumps with `scale-110` on completion
3. Per-report-card badges pulse and spin during sync
4. State transitions are instant (no fade/ease), causing visual jank during text input

## Solution

Replace the disruptive indicators with subtle, fixed-position elements that use CSS transitions for smooth state changes. No content shifting, no attention-grabbing animations.

## Changes

### 1. New Component: `src/components/pwa/SyncPulse.tsx`

A minimal sync indicator that replaces the `SyncStatusIndicator` badge in the header. Design:

- A small dot (8px) that sits in the header bar
- **Idle/Synced**: Not visible (opacity 0, fades out over 600ms)
- **Syncing**: Gentle pulse animation at low frequency (~2s cycle), muted blue color, opacity transitions in over 300ms
- **Error**: Solid red dot, static (no animation), fades in over 300ms
- **Unsynced items**: Subtle amber dot, static, with a count shown on hover via Tooltip
- All transitions use `transition-all duration-500 ease-in-out` for gradual state changes
- Never shifts layout -- uses fixed dimensions with opacity changes only

```tsx
// Core structure
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="relative flex items-center justify-center w-8 h-8">
        <div className={cn(
          "w-2 h-2 rounded-full transition-all duration-500 ease-in-out",
          // State-driven classes
          phase === 'syncing' && "bg-blue-500 animate-[pulse_2s_ease-in-out_infinite]",
          phase === 'error' && "bg-destructive opacity-100",
          phase === 'unsynced' && "bg-amber-500 opacity-80",
          phase === 'synced' && "bg-green-500 opacity-100",
          phase === 'idle' && "opacity-0",
        )} />
        {/* Unsynced count - tiny monospace badge */}
        {totalUnsynced > 0 && (
          <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono ...">
            {totalUnsynced}
          </span>
        )}
      </div>
    </TooltipTrigger>
    <TooltipContent>
      {/* Status details on hover -- same info as current tooltip */}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

Key behavior: After sync completes, the dot transitions to green for 2 seconds, then fades to invisible over 600ms. Uses `setTimeout` with cleanup (same pattern as current `justSynced`).

### 2. Dashboard: Replace Pending Sync Banner (`src/pages/Dashboard.tsx`)

**Remove** the large warning banner (lines 868-886) that shifts page content.

**Replace** with a thin, fixed-height strip above the report tabs that doesn't push content:

```tsx
{/* Inline sync status - thin strip, no layout shift */}
{unsyncedCount > 0 && (
  <div className="mb-2 flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                  text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20
                  border border-amber-200/50 dark:border-amber-800/30 rounded
                  transition-opacity duration-500 ease-in-out">
    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-[pulse_3s_ease-in-out_infinite]" />
    <span>{unsyncedCount} pending</span>
    <button
      onClick={() => forceSync()}
      disabled={isSyncing || !navigator.onLine}
      className="ml-auto text-xs underline underline-offset-2 hover:no-underline
                 disabled:opacity-40 disabled:no-underline"
    >
      {isSyncing ? 'syncing...' : 'sync now'}
    </button>
  </div>
)}
```

This is a compact one-liner: small dot + "3 pending" + "sync now" link. Minimal height (~28px vs the current ~56px banner). Uses a slow 3-second pulse on the dot only.

### 3. Per-Report Card Sync Badges (`src/pages/Dashboard.tsx` -- `getStatusBadge`)

**Remove**: The `animate-pulse` on the syncing badge and `animate-spin` on the RefreshCw icon during active sync.

**Replace** with smooth opacity transitions:

- Syncing state: Static badge with `opacity-70` and a gentle color, no spinning icon. Just text "Syncing" with a subtle left-border accent.
- Synced state: Unchanged (already subtle).
- Transition between states: Add `transition-opacity duration-500` to the badge container.

### 4. Header Swap (`src/pages/Dashboard.tsx`)

Replace the `SyncStatusIndicator` import and usage (if present in header) with the new `SyncPulse` component. The `StatusIndicator` (line 841) stays as-is since it's already minimal and only shows on mobile.

### 5. Tailwind Keyframe (if needed)

The `pulse` animation already exists in Tailwind defaults (`animate-pulse`). For the slower variant, use inline `animate-[pulse_2s_ease-in-out_infinite]` or `animate-[pulse_3s_ease-in-out_infinite]` which Tailwind JIT supports natively -- no config change needed.

## Files Modified

| File | Change |
|------|--------|
| `src/components/pwa/SyncPulse.tsx` | **New** -- minimal dot-based sync indicator |
| `src/pages/Dashboard.tsx` | Replace banner with thin strip; update getStatusBadge; swap header indicator |

## What Does NOT Change

- All sync logic (`useAutoSync`, `atomic-sync-manager`, `sync-events`) untouched
- `SyncStatusIndicator.tsx` and `StatusIndicator.tsx` files kept (not deleted) for backward compatibility -- just no longer rendered on Dashboard
- `ForceSyncButton` still available in header and profile dropdown
- PWA provider, network detection, offline storage -- all unchanged
- No routing, auth, or data fetching changes

