

# Replace Dashboard Background with Winter Olympic Skier Image

## Overview

Replace the current `dashboard-background.webp` with the uploaded skier image. Show it on all viewports (not just desktop) and add a dark overlay scrim to maintain legibility of the notification strip, report cards, and header against the busy action photo.

## Changes

### 1. Copy uploaded image to project

Copy `user-uploads://0x0.webp` to `src/assets/dashboard-background.webp`, replacing the existing file.

### 2. Update `src/pages/Dashboard.tsx` (lines 809-823)

Replace the current background section to:
- Show the image on **all viewports** (remove `hidden md:block`)
- Add a dark scrim overlay on top of the image for legibility
- Use `object-cover` with `object-[center_30%]` to keep the skier's upper body visible across aspect ratios (the subject is in the center-upper portion)

```tsx
{/* Background image */}
<div className="absolute inset-0 z-0">
  {/* Full-bleed background image -- all viewports */}
  <img
    src={dashboardBackground}
    alt=""
    className="w-full h-full object-cover object-[center_30%]"
  />
  
  {/* Dark scrim overlay for legibility of foreground content */}
  <div className="absolute inset-0 bg-gradient-to-b from-slate-900/70 via-slate-900/50 to-slate-900/70" />
  
  {/* Reduced motion fallback */}
  <div className="absolute inset-0 bg-gradient-to-br from-blue-900/80 via-sky-900/70 to-blue-900/80 hidden motion-reduce:block" />
</div>
```

Key design decisions:
- **`object-[center_30%]`**: Positions the focal point (skier) toward the upper third, preventing important cropping on tall mobile screens
- **Gradient scrim** (`from-slate-900/70 via-slate-900/50 to-slate-900/70`): Darker at top (header area) and bottom (cards), lighter in the middle to let the image show through while keeping all text readable
- The existing `bg-background/80 backdrop-blur-sm` on line 824 provides an additional readability layer for the main content area

### 3. No other files change

The image import on line 23 (`import dashboardBackground from "@/assets/dashboard-background.webp"`) stays identical since the filename is unchanged.

## Legibility Verification

| Element | Protection |
|---------|-----------|
| Header (logos, user dropdown) | `bg-card/95 backdrop-blur-sm` (line 828) -- opaque card background |
| Holiday Banner | Rendered above `z-10` content layer with its own background |
| Sync status strip | Fixed height with own background styling, sits within `z-10` |
| Report Cards | Inside `bg-background/80 backdrop-blur-sm` container + card backgrounds |
| Notification strip | Own background color, unaffected by image layer at `z-0` |

## Files Modified

| File | Change |
|------|--------|
| `src/assets/dashboard-background.webp` | Replaced with skier image |
| `src/pages/Dashboard.tsx` | Update background section (lines 809-823) for full-viewport image with dark scrim |

