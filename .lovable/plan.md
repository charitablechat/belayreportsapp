

# Fix Mobile Image Flashing and Layout Shift

## Root Cause Analysis

After auditing the code, I identified **three distinct causes** of the flashing/CLS on mobile:

### Cause 1: Aggressive `loaded` state reset (OptimizedImage.tsx, line 27-29)
Every time the `src` prop changes (which happens on every silent refresh when signed URLs rotate), `setLoaded(false)` fires immediately. This hides the current image (opacity: 0) and shows the skeleton, even though the underlying photo content hasn't changed -- only the signed URL token rotated. On mobile with slower connections, this creates a visible flash every time the network status toggles.

### Cause 2: Synchronous URL revocation (PhotoGallery.tsx, line 232)
`oldUrls.forEach(url => URL.revokeObjectURL(url))` runs synchronously right after `setPhotos()`. React batches state updates, so the old object URLs can be revoked **before** the DOM actually updates to show the new URLs. This causes a brief broken-image flash on mobile where the browser tries to render the old (now-revoked) URL.

### Cause 3: No fixed aspect ratio on image containers
The `h-48` class on the image container doesn't reserve space until the image loads. On mobile, the skeleton and image can cause a small layout shift (CLS) as the content reflows during the load-to-visible transition.

---

## Planned Changes

### 1. OptimizedImage.tsx -- Smart cross-fade with previous-src tracking

- Add a `prevSrcRef` to track the previous `src` value
- Only reset `loaded` to `false` if the image's **content identity** has actually changed (not just a URL token rotation). Since we can't easily distinguish content changes from URL rotations at this level, instead: **keep the old image visible while the new one loads** by deferring the skeleton display
- Add an `onError` handler to gracefully fall back to the skeleton if the new URL fails
- Add `aspect-ratio` support via the container to eliminate CLS

### 2. PhotoGallery.tsx -- Deferred URL revocation with requestAnimationFrame

- Replace the synchronous `oldUrls.forEach(url => URL.revokeObjectURL(url))` with a deferred cleanup using `requestAnimationFrame` + `setTimeout(0)` to guarantee the DOM has committed the new URLs before revoking old ones
- Memoize the `loadPhotos` function with `useCallback` to prevent stale closure issues
- Add a guard to skip redundant silent refreshes if photos haven't changed (compare photo IDs)

### 3. CSS -- Retro-Tech scanline skeleton with fixed aspect ratio

- Update the `.optimized-image-shimmer` animation to include a horizontal scanline sweep effect matching the Retro-Tech Terminal aesthetic
- Add a utility class for fixed aspect-ratio photo containers to prevent CLS

### 4. Version bump to v2.5.6

---

## Technical Details

### OptimizedImage.tsx changes

```typescript
// Track previous src to enable cross-fade without flash
const prevSrcRef = useRef<string>(src);
const [currentSrc, setCurrentSrc] = useState(src);

useEffect(() => {
  if (src !== prevSrcRef.current) {
    // New URL -- don't reset loaded yet; let new image load behind the old one
    setCurrentSrc(src);
    prevSrcRef.current = src;
  }
}, [src]);

// Only show skeleton on initial mount, not on URL rotation
const handleLoad = useCallback(() => setLoaded(true), []);
const handleError = useCallback(() => {
  setLoaded(false); // Show skeleton on error
}, []);
```

The `img` element will use `currentSrc` and transition smoothly without flashing the skeleton on URL rotation.

### PhotoGallery.tsx deferred revocation

```typescript
// Deferred revocation: wait for React commit + browser paint
const oldUrls = objectUrlsRef.current;
objectUrlsRef.current = newObjectUrls;
setPhotos(mergedPhotos);

// Revoke AFTER the DOM has painted the new URLs
requestAnimationFrame(() => {
  setTimeout(() => {
    oldUrls.forEach(url => URL.revokeObjectURL(url));
  }, 0);
});
```

### CSS scanline skeleton (index.css)

Add a horizontal scanline sweep to the existing `.optimized-image-shimmer`:

```css
@keyframes scanline-sweep {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}

.optimized-image-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(34, 197, 94, 0.15) 45%,
    rgba(34, 197, 94, 0.3) 50%,
    rgba(34, 197, 94, 0.15) 55%,
    transparent 100%
  );
  animation: scanline-sweep 3s linear infinite;
  pointer-events: none;
}
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/ui/optimized-image.tsx` | Smart cross-fade, error handling, aspect-ratio support |
| `src/components/PhotoGallery.tsx` | Deferred URL revocation via rAF + setTimeout |
| `src/index.css` | Scanline sweep animation on skeleton |
| `vite.config.ts` | Bump to v2.5.6 |

## What Does NOT Change

- Photo capture, compression, or offline storage logic
- Drag-and-drop reordering
- Soft-delete system (v2.5.5)
- Background sync pipeline
- Signed URL generation (server-side, not exposed in frontend)
- RLS policies

## Security Audit

- Signed URL generation uses `supabase.storage.createSignedUrl()` which is a server-side SDK call -- no API keys are exposed in frontend code
- The anon key used by the Supabase client is a publishable key (safe for frontend)
- No sensitive logic is exposed

