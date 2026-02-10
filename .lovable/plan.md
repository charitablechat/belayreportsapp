
# Replace Dashboard Background Video with Static Image

## Overview

Replace the indoor rock climbing video background with the uploaded ropes course photo. Use `object-cover` with `object-position: center` to prevent any warping. No changes to `UserProfileDropdown` or `goBack(navigate)` logic -- those are in separate components unaffected by this swap.

## Changes

### 1. Copy uploaded image to project

Copy `user-uploads://DSC03674.webp` to `src/assets/dashboard-background.webp`.

### 2. Update `src/pages/Dashboard.tsx`

**Import change** (line 23):
- Remove: `import dashboardBackgroundVideo from "@/assets/dashboard-background.mp4"`
- Add: `import dashboardBackground from "@/assets/dashboard-background.webp"`

**Background section** (lines 805-827):
Replace the video element and motion-reduce fallback with a single `<img>` tag:

```tsx
{/* Background image */}
<div className="absolute inset-0 z-0">
  {/* Gradient overlay for mobile */}
  <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-sky-900/20 to-blue-900/30 md:hidden" />
  
  {/* Static image - desktop, no warping */}
  <img
    src={dashboardBackground}
    alt=""
    className="hidden md:block w-full h-full object-cover object-center"
  />
  
  {/* Gradient fallback when image hidden */}
  <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-sky-900/20 to-blue-900/30 hidden motion-reduce:block" />
</div>
```

Key points:
- `object-cover` + `object-center` ensures no warping/stretching
- `alt=""` since it's purely decorative
- Winter-themed gradient colors (blue/sky) replace the red/green Christmas palette on mobile
- The overlay `bg-background/80 backdrop-blur-sm` on line 828 still provides readability

## Impact Verification

| Component | Impact |
|-----------|--------|
| `UserProfileDropdown` | None -- separate component, no background dependency |
| `goBack(navigate)` | None -- navigation utility in `src/lib/navigation.ts`, unrelated |
| Layout/z-index | None -- same `absolute inset-0 z-0` container, same `relative z-10` content layer |

## Files Modified

| File | Change |
|------|--------|
| `src/assets/dashboard-background.webp` | New -- copied from upload |
| `src/pages/Dashboard.tsx` | Swap video import/element for static image |
