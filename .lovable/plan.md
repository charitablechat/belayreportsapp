

# Retro-Tech Skeleton Loader and Image Loading Optimization

## Current State (No Bugs Found)

All photo network requests return HTTP 200. No console errors. The `pointer-events: none` wrappers were already removed in the previous fix, so no CSS is obstructing lazy-loading triggers or image requests. The reported "loading failures" are likely perceived latency from the generic shimmer skeleton that does not visually communicate loading progress in the Retro-Tech aesthetic.

## Changes

### 1. Retro-Tech CRT Skeleton Loader (`src/components/ui/optimized-image.tsx`)

Replace the generic shimmer with a CRT-styled pulsing green skeleton that matches the Retro-Tech Terminal aesthetic:

- Background: `bg-zinc-950` (near-black, matching the terminal look)
- Pulse effect: pulsing green scanline overlay using `rgba(34,197,94, 0.15)` (`#22c55e`)
- CRT scanlines: repeating-linear-gradient matching the `CompletionLockDialog` pattern
- Add a `priority` prop: when true, skip `IntersectionObserver` and render the `<img>` immediately (for above-the-fold / hero images)

```text
+---------------------------------------------+
|  OptimizedImage (priority=false, default)    |
|                                              |
|  [zinc-950 bg] + [green pulse scanlines]     |
|         |                                    |
|         v  IntersectionObserver fires        |
|  <img loading="lazy" onLoad={fadeIn}>        |
+---------------------------------------------+

+---------------------------------------------+
|  OptimizedImage (priority=true)              |
|                                              |
|  [zinc-950 bg] + [green pulse scanlines]     |
|         |                                    |
|         v  Rendered immediately (no IO)      |
|  <img loading="eager" onLoad={fadeIn}>       |
+---------------------------------------------+
```

### 2. CRT Shimmer CSS (`src/index.css`)

Replace the existing `.optimized-image-shimmer` keyframe with a Retro-Tech version:

- New keyframe `@keyframes crt-pulse` using green channel pulsing
- `.optimized-image-shimmer` updated to use `bg-zinc-950` base with green scanline overlay
- Maintains the same class name so no downstream changes needed

### 3. PhotoGallery Integration (`src/components/PhotoGallery.tsx`)

No structural changes needed. The `OptimizedImage` component is already used correctly. The new skeleton styling will automatically apply.

### 4. Report Form Skeleton Cards

No changes to `ReportCardSkeleton.tsx` -- the generic skeleton is appropriate for dashboard cards. The CRT treatment is specific to photo loading within report forms.

## Files Modified

| File | Change |
|------|--------|
| `src/components/ui/optimized-image.tsx` | Add `priority` prop, CRT skeleton markup |
| `src/index.css` | Replace `.optimized-image-shimmer` with CRT-styled green pulse animation |

## What Does NOT Change

- PhotoGallery.tsx (already uses OptimizedImage correctly)
- Photo caching/fetch logic (no bugs found)
- Lock interception handlers (working correctly)
- Backend, edge functions, RLS policies
- No secrets or API keys affected

