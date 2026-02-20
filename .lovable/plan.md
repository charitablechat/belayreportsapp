

# Boost Contrast and Frost on Glassmorphism Badges

Apply the previously approved styling tweaks to increase contrast and frosted-glass effect across three components. Purely cosmetic -- no logic changes.

## Changes

### 1. `src/components/ActiveTimerDisplay.tsx` (container classes, ~line 26)
- `bg-white/10` -> `bg-white/15 dark:bg-black/30`
- `backdrop-blur-[12px]` -> `backdrop-blur-xl`
- `border-white/15` -> `border-white/20`
- `shadow-sm` -> `shadow-md shadow-black/5`

### 2. `src/components/ui/data-integrity-badge.tsx` (container classes, ~lines 60-63)
- `bg-white/10 dark:bg-black/20` -> `bg-white/15 dark:bg-black/30`
- `backdrop-blur-[12px]` -> `backdrop-blur-xl`
- Add `shadow-md shadow-black/5`

### 3. `src/components/admin/VersionHistoryPanel.tsx` (version cards)
- Card background: `bg-white/5 dark:bg-black/10` -> `bg-white/10 dark:bg-black/20`
- Card border: `border-white/10` -> `border-white/15`

## No Changes To
- Any functional logic, props, or interfaces
- Status colors (emerald, amber, sky)
- Typography or font sizing
- Any other files

