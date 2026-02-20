

# Restyle ActiveTimerDisplay: Glassmorphism Clock Badge

## Problem
The `ActiveTimerDisplay` component uses a hard-coded black background (`#1a1a1a`) with neon green (`#32CD32`) text -- a "Matrix terminal" look that clashes with the application's established Minimal Brutalist + Glassmorphism aesthetic.

## New Design Direction
Replace the opaque black/green scheme with a **frosted glass pill** that matches existing UI elements like the `AuthenticatedHeader` and `AutoSaveIndicator`:

- **Background**: `bg-white/10 dark:bg-black/20` with `backdrop-blur-[12px]`
- **Border**: `border border-white/15`
- **Text**: `text-foreground/80` for the time, muted tones for "REC" label
- **Recording dot**: Subtle `bg-emerald-400` (Emerald 400 from the status palette) instead of neon green
- **Typography**: Keep `font-mono` and `tabular-nums` for the timer digits -- monospaced is correct for a clock
- **Cursor**: Remove the blinking terminal cursor (`_`) -- it reinforces the terminal look that is being removed

## Single File Change

### `src/components/ActiveTimerDisplay.tsx`

**Outer container** (line 26):
```
Before: bg-[#1a1a1a] border border-[#32CD32]/30
After:  bg-white/10 dark:bg-black/20 backdrop-blur-[12px] border border-white/15 shadow-sm
```

**REC dot** (lines 30-34):
```
Before: bg-[#32CD32] / bg-[#32CD32]/30
After:  bg-emerald-400 / bg-muted-foreground/30
```

**REC text** (lines 37-39):
```
Before: text-[#32CD32] / text-[#32CD32]/40
After:  text-emerald-400 / text-muted-foreground/40
```

**Time digits** (line 46):
```
Before: text-[#32CD32]
After:  text-foreground/80
```

**Blinking cursor** (lines 49-51): Remove entirely.

## What Does NOT Change
- `formatTime` logic
- `memo` wrapper
- Props interface
- Timer hook usage in InspectionForm, TrainingForm, DailyAssessmentForm
- No other files modified

