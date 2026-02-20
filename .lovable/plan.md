

# Apply Glassmorphism Aesthetic to Dashboard Top Banner

## Summary

Update the `<header>` element in `src/pages/Dashboard.tsx` (line 991) to use the same frosted glass styling as the rest of the app's glassmorphism components, matching the "Welcome to Rope Works" foyer section aesthetic.

## File Changed

**`src/pages/Dashboard.tsx`** -- single line edit

## What Changes

### Header container class (line 991)

**Current:**
```
border-b bg-card/95 backdrop-blur-sm
```

**New (Glassmorphism):**
```
border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5
```

This exactly mirrors the established glassmorphism palette:
- `bg-white/10` for light mode, `dark:bg-black/20` for dark mode (semi-transparent frosted effect)
- `backdrop-blur-[12px]` for the strong frosted glass blur (matches AuthenticatedHeader)
- `border-white/20` for the subtle light border
- `shadow-md shadow-black/5` for depth
- `border-b` retained for the bottom separator

## What Does NOT Change

- All banner content (logos, sync indicators, badges, network quality)
- The `mr-14` clearance for the floating profile avatar
- The Super Admin badge styling
- The "Welcome to Rope Works" foyer section (already styled separately)
- Any state management, data loading, or sync logic
- No new dependencies

