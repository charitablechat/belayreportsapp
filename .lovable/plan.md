

## Make "Saved" Indicator Match "REC" Pill on All Screen Sizes

### Problem
The AutoSaveIndicator currently uses the glassmorphism pill style only on mobile. On desktop (sm: and above), the pill styling is stripped away via responsive overrides (`sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:rounded-none`), making it look plain -- unlike the ActiveTimerDisplay "REC" pill which always shows as a pill.

### Solution
Update the `mobilePill` class string in `AutoSaveIndicator.tsx` to always render the pill shape, matching the ActiveTimerDisplay component exactly.

### Changes

**File: `src/components/AutoSaveIndicator.tsx`**

- Replace the `mobilePill` variable (line 39) that currently has responsive overrides stripping the pill on desktop
- New value: `"inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 dark:bg-black/30 backdrop-blur-xl border border-white/20 shadow-md shadow-black/5"` -- identical to the ActiveTimerDisplay wrapper
- This is the same styling used by ActiveTimerDisplay at line 28 of that component
- The green color (`text-emerald-400`) for the "Saved" state is already correct and will remain unchanged
- No functional changes -- save timing, retry logic, and all state handling remain as-is

### What stays the same
- All status colors (emerald for saved, amber for unsaved, destructive for error, primary for saving)
- Icons (CheckCircle, Clock, AlertCircle, Loader2, CloudOff, RefreshCw)
- Text content and mobile/desktop text visibility (`hidden sm:inline` vs `sm:hidden`)
- Save timing and retry functionality

