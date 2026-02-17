

# Fix Remaining Photo Flash: Object URL Revocation During Silent Refresh

## Root Cause

In `PhotoGallery.tsx`, lines 108-112 revoke ALL existing object URLs at the **start** of every `loadPhotos()` call, including silent refreshes. This means:

1. User is viewing photos (some rendered via object URLs from IndexedDB blobs)
2. Network status toggles, triggering `loadPhotos(true)` (silent)
3. All object URLs are immediately revoked -- images currently on screen break
4. New URLs are generated and `setPhotos()` is called moments later
5. User sees a brief blank/broken flash in the gap

## Fix

### 1. Defer Object URL Cleanup (`src/components/PhotoGallery.tsx`)

Instead of revoking old URLs at the start of `loadPhotos`, collect new URLs first, then swap the ref atomically after `setPhotos()`. Old URLs are revoked **after** the new ones are in place, eliminating the gap.

```
const loadPhotos = async (silent = false) => {
  try {
    if (!silent) setLoading(true);
    
    // Collect new URLs in a separate array (don't revoke old ones yet)
    const newObjectUrls: string[] = [];
    
    // ... build photos using newObjectUrls instead of objectUrlsRef ...
    
    // Swap: revoke old URLs AFTER new state is set
    const oldUrls = objectUrlsRef.current;
    objectUrlsRef.current = newObjectUrls;
    setPhotos(mergedOrOfflinePhotos);
    
    // Now safe to revoke old URLs (React has the new ones queued)
    oldUrls.forEach(url => URL.revokeObjectURL(url));
  }
};
```

### 2. Reset `loaded` State on `src` Change (`src/components/ui/optimized-image.tsx`)

Add a `useEffect` that resets `loaded = false` when `src` changes. This ensures the skeleton-to-image crossfade plays correctly when a photo URL rotates (e.g., signed URL refresh), rather than showing a stale loaded state for a new image that hasn't decoded yet.

```typescript
useEffect(() => {
  setLoaded(false);
}, [src]);
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/PhotoGallery.tsx` | Defer object URL revocation until after new state is set |
| `src/components/ui/optimized-image.tsx` | Reset `loaded` state when `src` prop changes |

## What Does NOT Change

- Photo caching, sync, or persistence logic
- Drag-and-drop reordering
- Caption editing
- Brutalist styling (already applied)
- Backend, edge functions, or RLS policies

