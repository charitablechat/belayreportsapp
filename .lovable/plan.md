

# Glassmorphism Profile Button Refinement

## Overview
Apply a premium glassmorphism aesthetic to the floating user profile trigger button, with layered shadows, a hover scale transition, and an enhanced avatar ring -- all purely visual CSS changes with zero impact on data or auth logic.

## Changes

### 1. `src/components/AuthenticatedHeader.tsx` (lines 136-139)
Replace the plain `fixed top-3 right-3 z-50` wrapper with a glassmorphism container:
- `backdrop-blur-[12px]` for the frosted glass effect
- Translucent background: `bg-white/10 dark:bg-black/20`
- Subtle 1px border: `border border-white/10`
- Multi-layered soft shadow: inline `style` with compound `box-shadow`
- `rounded-full` to match the circular avatar
- Hover: `scale(1.05)` with `transition-transform duration-300 ease-in-out`

### 2. `src/components/UserProfileDropdown.tsx` (line 77)
Remove existing padding/sizing from the ghost trigger `Button` so the glassmorphism container handles all visual chrome. Change to `variant="ghost" size="icon" className="rounded-full p-0 bg-transparent hover:bg-transparent"`.

### 3. `src/components/ui/user-avatar.tsx` (lines 23-29)
- Add a subtle inner glow ring to all avatars (not just super admins): `ring-1 ring-white/20 shadow-inner`
- Keep the existing super-admin amber ring as an additive layer on top
- Ensure the `User` fallback icon remains as the high-quality fallback

## Technical Notes
- All changes are CSS-only on three existing files
- No new state, hooks, network calls, or data access is introduced
- The `currentUser` and `userProfile` prop interfaces remain unchanged -- no sensitive metadata is added or exposed
- Data safety protocols (IndexedDB, sync, backups) are entirely unaffected

