

## Rotating Random Backgrounds on Dashboard, Profile, and Admin — Keep Animated Zipliner on Auth/Landing

### What Changes

**1. Save the 10 uploaded background images**
Copy all 10 uploaded images into `src/assets/backgrounds/` with clean names:
- `bg-01-blue-wave.png` (existing `app-background.png`)
- `bg-02-road-runner.png`
- `bg-03-marble-gold.png`
- `bg-04-wood-planks.png`
- `bg-05-wood-rings.png`
- `bg-06-wood-tiles.png`
- `bg-07-bamboo.png`
- `bg-09-gold-water.png`
- `bg-12-pool-tiles.png`
- `bg-17-treasure-map.png`

**2. Create background manager utility (`src/lib/background-manager.ts`)**
- Import all 10 background images
- On first call per session, pick a random index, store it in `sessionStorage` under key `app-bg-index`
- Export `getSessionBackground()` that returns the selected image for the session
- A new login triggers a new random pick

**3. Restore the animated zipliner video on Auth and Landing pages**

**Auth (`src/components/Auth.tsx`)**
- Replace the static `appBackground` image with the `auth-background.mp4` video element (the file still exists in `src/assets/`)
- Restore the `<video>` tag with autoPlay, loop, muted, playsInline attributes

**Landing (`src/pages/AuroraLanding.tsx`)**
- Same change: replace the static image with the `auth-background.mp4` video background

**4. Use rotating backgrounds on Dashboard, Profile, and Admin**

**Dashboard (`src/pages/Dashboard.tsx`)**
- Replace the hardcoded `dashboardBackground` import with `getSessionBackground()`

**Profile (`src/pages/Profile.tsx`)**
- Add a fixed background image layer behind the page content using `getSessionBackground()`
- Add a gradient overlay for readability (`bg-background/70 backdrop-blur-sm`)

**Admin (`src/pages/SuperAdminDashboard.tsx`)**
- Wrap the return in a container with a fixed background image layer using `getSessionBackground()`
- Add a gradient overlay for readability

### Session Behavior

- A random background is selected on first page load after login and stored in `sessionStorage`
- Navigating between Dashboard, Profile, and Admin shows the same background
- Signing out and back in picks a new random one
- Auth and Landing pages always show the animated zipliner video, unaffected by the random selection

### Files Summary

| File | Change |
|------|--------|
| `src/assets/backgrounds/*.png` (x10) | New image assets |
| `src/lib/background-manager.ts` | New utility for random session-based selection |
| `src/components/Auth.tsx` | Restore video background (remove static image) |
| `src/pages/AuroraLanding.tsx` | Restore video background (remove static image) |
| `src/pages/Dashboard.tsx` | Use `getSessionBackground()` |
| `src/pages/Profile.tsx` | Add background image layer with overlay |
| `src/pages/SuperAdminDashboard.tsx` | Add background image layer with overlay |

