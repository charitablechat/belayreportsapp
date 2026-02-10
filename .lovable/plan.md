

# Fix Dashboard Background Image Display

## Problem

The background image appears too enlarged because `object-cover` forces the image to fill the entire viewport height, cropping heavily on both sides. Combined with the `bg-background/80 backdrop-blur-sm` overlay on the content layer (line 824), the image is both over-cropped and barely visible.

## Solution

Use a **fixed/contained top-portion** approach instead of stretching the image across the full viewport:

1. **Limit the background image to the top portion** of the screen (roughly 40-50vh) and let it fade into the content background, rather than stretching it across the full `min-h-screen` container. This preserves the image's natural aspect ratio and avoids aggressive cropping.

2. **Use `object-contain` on desktop / `object-cover` on mobile** with constrained height so the image shows more of the scene without over-zooming.

3. **Soften the content overlay** from `bg-background/80` to a lighter value so the image is actually visible where it shows.

## Changes to `src/pages/Dashboard.tsx`

### Background container (lines 809-823)

Replace the full-bleed `absolute inset-0` approach with a height-constrained background that fades out at the bottom:

```tsx
{/* Background image */}
<div className="absolute inset-x-0 top-0 z-0 h-[45vh] md:h-[50vh] overflow-hidden">
  <img
    src={dashboardBackground}
    alt=""
    className="w-full h-full object-cover object-center"
  />
  
  {/* Gradient fade: image fades into the page background at the bottom */}
  <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-transparent to-background" />
  
  {/* Reduced motion fallback */}
  <div className="absolute inset-0 bg-gradient-to-br from-blue-900/80 via-sky-900/70 to-blue-900/80 hidden motion-reduce:block" />
</div>
```

### Content overlay (line 824)

Reduce the opacity and remove backdrop-blur so the image shows through in the header area:

```tsx
<div className="relative z-10 min-h-screen">
```

The header already has its own `bg-card/95 backdrop-blur-sm` (line 828), so legibility is maintained there. Report cards below the fold sit against the normal `bg-background` since the image fades out by ~45vh.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Height-constrained to 45-50vh | Shows the full width of the image without extreme vertical cropping |
| `object-center` instead of `object-[center_30%]` | With constrained height, the default center position works naturally |
| Gradient fades to `to-background` | Seamlessly blends the image bottom edge into the page color -- no hard cutoff |
| Lighter top scrim (`from-slate-900/50`) | Darker enough for header legibility, but lets the image show through |
| Remove `bg-background/80 backdrop-blur-sm` from content div | This was hiding the image entirely; header/cards have their own backgrounds |

## Legibility Still Guaranteed

| Element | Protection |
|---------|-----------|
| Header | Own `bg-card/95 backdrop-blur-sm` background |
| Holiday Banner | Own background styling |
| Report Cards | Below the image fade zone; sit on normal `bg-background` |
| Sync status strip | Within header zone with card background |

## Files Modified

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Constrain background image height, soften overlays, remove content-layer blur |

