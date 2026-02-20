

# Match AutoSaveIndicator to ActiveTimerDisplay Glassmorphism Style

## Summary

Update the `AutoSaveIndicator` component's container styling to exactly match the `ActiveTimerDisplay` pill, while preserving all auto-save logic, responsive text behavior, and status-specific colors.

## File Changed

**`src/components/AutoSaveIndicator.tsx`** (line 39)

## What Changes

### Container class (the `mobilePill` variable, line 39)

**Current:**
```
bg-slate-900/60 backdrop-blur-sm border border-white/10 rounded-sm px-2 py-0.5
```
With responsive overrides: `sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:rounded-none sm:px-0 sm:py-0`

**New (matches ActiveTimerDisplay exactly):**
```
bg-white/15 dark:bg-black/30 backdrop-blur-xl border border-white/20 shadow-md shadow-black/5 rounded-full px-2.5 py-1
```
The responsive overrides (`sm:bg-transparent sm:backdrop-blur-none ...`) stay as-is so desktop remains inline/plain.

### Status colors (lines 83, 93)

- **Saved state** (line 83): `text-green-600 dark:text-green-400` becomes `text-emerald-400` to match the emerald palette used by ActiveTimerDisplay.
- **Unsaved state** (line 93): `text-yellow-600 dark:text-yellow-400` becomes `text-amber-400` for consistency with the app's status palette.

## What Does NOT Change

- All logic (debounce, intervals, IndexedDB persistence)
- Props and interface
- Responsive text pattern (icon-only on mobile via `sm:hidden` / `hidden sm:inline`)
- Error, saving, and pending_sync states (only container styling updates)
- The `ActiveTimerDisplay` component itself
