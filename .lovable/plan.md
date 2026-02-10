

# Fix Dashboard Notification Layout Shift

## Problem

The sync status strip (lines 870-886 of `Dashboard.tsx`) conditionally renders with `{unsyncedCount > 0 && ...}`, causing content below it to shift down/up when it appears or disappears. The `mb-2` margin compounds the issue.

## Solution

Keep the container **always rendered** with a fixed height, and control visibility purely through **opacity and pointer-events**. This eliminates all layout reflow.

## Changes to `src/pages/Dashboard.tsx` (lines 869-886)

Replace the conditional render with an always-present container:

```tsx
{/* Inline sync status -- always present, visibility via opacity only */}
<div
  className={cn(
    "mb-2 flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded",
    "border transition-all duration-500 ease-in-out",
    unsyncedCount > 0
      ? "opacity-100 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30"
      : "opacity-0 pointer-events-none border-transparent"
  )}
>
  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-[pulse_3s_ease-in-out_infinite]" />
  <span>{unsyncedCount} pending</span>
  <button
    onClick={() => forceSync()}
    disabled={isSyncing || !navigator.onLine}
    className="ml-auto text-xs underline underline-offset-2 hover:no-underline disabled:opacity-40 disabled:no-underline"
  >
    {isSyncing ? 'syncing...' : 'sync now'}
  </button>
</div>
```

Key differences from current code:
- Container always occupies its space (no conditional `&&` render)
- When `unsyncedCount === 0`: `opacity-0 pointer-events-none border-transparent` -- invisible but still in the DOM
- When `unsyncedCount > 0`: fades in over 500ms
- `cn()` utility already imported in the file

### Import check

Confirm `cn` is imported. If not, add `import { cn } from '@/lib/utils'` to the imports.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Replace conditional render with opacity-based visibility (lines 869-886) |

## What Does NOT Change

- Sync logic, forceSync handler, all PWA hooks
- SyncPulse header indicator
- Report cards, tabs, foyer section
- No secrets, no backend changes

