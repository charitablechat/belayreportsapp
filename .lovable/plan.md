

# Optimize Photo Gallery Image Loading

## Scope

The report headers contain no images — all photo rendering is in `PhotoGallery.tsx` and its drag overlay. This plan focuses there.

## What Already Works (No Changes Needed)

- Image compression before upload (image-compression.ts) -- already outputs JPEG with quality/size limits
- Local caching via IndexedDB (photo-cache.ts) -- 24h TTL with validation
- Offline fallback architecture (cached-auth.ts) -- no interference risk
- isReadOnly enforcement -- photos use `readOnly` prop, unaffected by rendering changes

## Changes

### 1. New Component: `OptimizedImage` (src/components/ui/optimized-image.tsx)

A reusable image component with:
- `loading="lazy"` attribute for native browser lazy loading
- Intersection Observer fallback for older browsers
- Progressive loading: renders a skeleton shimmer placeholder until the image's `onLoad` fires, then cross-fades with `opacity 0.3s ease-in-out`
- Minimal Brutalist styling: sharp-edged container (no rounded corners on the image itself), high-contrast skeleton with `linear-gradient` animation on a dark bg

Skeleton shimmer effect using CSS:
```
background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--muted-foreground)/0.1) 50%, hsl(var(--muted)) 75%);
background-size: 200% 100%;
animation: shimmer 1.5s infinite;
```

### 2. Update `PhotoGallery.tsx`

Replace raw `<img>` tags (line 354-358 and line 413-416) with the new `OptimizedImage` component. No changes to data fetching, caching, or drag-and-drop logic.

### 3. Update `index.css`

Add the `@keyframes shimmer` animation for the skeleton gradient.

## Technical Notes

- No new dependencies required -- uses native `loading="lazy"` and `IntersectionObserver`
- Object URL cleanup in PhotoGallery remains unchanged
- The `OptimizedImage` component accepts `src`, `alt`, `className`, and an optional `containerClassName` prop
- Security: No auth tokens, API keys, or secrets are involved in rendering -- this is purely a display-layer optimization

