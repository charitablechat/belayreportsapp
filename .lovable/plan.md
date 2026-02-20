

# Convert Remaining Black & Green Components to Glassmorphism

## Components to Update

Two components still use the "Matrix terminal" black-and-green aesthetic and need to match the glassmorphism style already applied to `ActiveTimerDisplay` and `AutoSaveIndicator`.

### 1. `src/components/ui/data-integrity-badge.tsx`

**Current**: Deep black background (`bg-[hsl(0,0%,5%)]`), neon green text (`hsl(120,100%,56%)`), green glow borders, `crt-scanlines` overlay.

**New styling**:
- Container: `bg-white/10 dark:bg-black/20 backdrop-blur-[12px] border border-white/15 shadow-sm` (matching the clock badge)
- Remove `crt-scanlines` class
- Status colors shift to theme-aware equivalents:
  - **hard-saved**: `text-emerald-400`, `border-emerald-400/20`
  - **pending**: `text-amber-400`, `border-amber-400/20`
  - **synced**: `text-sky-400`, `border-sky-400/20`
  - **shield-active**: `text-emerald-400`, `border-emerald-400/30`
- Remove neon glow `box-shadow` effects
- Keep `font-mono`, `text-[10px]`, `tracking-wider`, and all functional logic unchanged

### 2. `src/components/admin/VersionHistoryPanel.tsx`

**Current**: Full black sheet background (`bg-[hsl(0,0%,5%)]`), green borders, green text throughout, `crt-scanlines`.

**New styling**:
- Sheet background: `bg-background/95 backdrop-blur-xl border-l border-white/15` (frosted panel)
- Remove `crt-scanlines` from sheet container
- Title/description: `text-foreground` / `text-muted-foreground` instead of green
- Version cards: `bg-white/5 dark:bg-black/10 border border-white/10` instead of black with green borders
- Version number: `text-emerald-400 font-bold` (keep emerald accent for version labels)
- Trigger badge: `border-white/15 text-muted-foreground`
- Restore button: `text-muted-foreground hover:text-foreground hover:bg-white/10`
- Metadata row: `text-muted-foreground/60`
- Loading/empty states: `text-muted-foreground/40`

### 3. `src/index.css` (cleanup)

- Remove the `.crt-scanlines` CSS class and `integrity-pulse` / `.integrity-glow` keyframe since they are no longer used anywhere after the above changes

## Files Modified

| File | Change |
|------|--------|
| `src/components/ui/data-integrity-badge.tsx` | Replace black/green with glassmorphism pill |
| `src/components/admin/VersionHistoryPanel.tsx` | Replace terminal sheet with frosted glass panel |
| `src/index.css` | Remove `.crt-scanlines` and `.integrity-glow` CSS |

## What Does NOT Change
- All functional logic (version loading, restoring, status mapping)
- Component props and interfaces
- `ActiveTimerDisplay` and `AutoSaveIndicator` (already converted)
- Any backend or edge function code

