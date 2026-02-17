

# Image Loading Optimization: Eliminate Layout Shift and Flashing

## Root-Cause Analysis

### 1. Layout Shift (CLS)
The `OptimizedImage` component sets `containerClassName="h-48"` on the wrapper div but the inner `<img>` element has no explicit `width`/`height` attributes. When the image transitions from `opacity-0` to `opacity-1`, the browser may reflow surrounding content if the image's intrinsic dimensions differ from the container. The fix is to enforce `aspect-ratio: 4/3` on the container and ensure the `<img>` fills it with `object-fit: cover` and `w-full h-full`.

### 2. Flash on Network Status Change (React Re-mount)
`PhotoGallery.tsx` lists `isOnline` in its `useEffect` dependency array (line 92). Every time the network status toggles, `loadPhotos()` reruns, setting `loading=true`, which unmounts ALL photo elements and shows the spinner. When photos reload moments later, this creates a visible flash. The fix is to NOT reset `loading=true` on subsequent fetches -- only on initial mount.

### 3. Lock Interceptors (NOT a cause)
The `handleLockedFieldClick` handler returns immediately when `!isCompletionLocked` (line 134). It does not `preventDefault()` or `stopPropagation()` in the unlocked state, so it has zero impact on image loading, IntersectionObserver triggers, or the browser's image decoding thread. No changes needed.

### 4. No Hardcoded Image URLs
All photo URLs are generated via signed URL calls at runtime. No CDN endpoints or secrets are hardcoded. No changes needed.

## Changes

### 1. OptimizedImage -- Eliminate CLS and Add Brutalist Skeleton (`src/components/ui/optimized-image.tsx`)

- Add `width` and `height` props (optional, default undefined) passed through to the `<img>` element for intrinsic sizing hints
- Add `decoding="async"` to the `<img>` to prevent blocking the main thread during decode
- Ensure `<img>` uses `w-full h-full` so it fills the container without reflow
- Add `border-2 border-black dark:border-white` to the skeleton overlay to match Minimal Brutalist aesthetic while loading

### 2. PhotoGallery -- Eliminate Flash on Network Change (`src/components/PhotoGallery.tsx`)

- Split the `useEffect` into two concerns:
  - Initial load: runs once on mount with `loading=true`
  - Network-triggered refresh: runs when `isOnline` changes but does NOT set `loading=true`, performing a silent background merge instead
- This prevents the full unmount/remount flash when toggling between online and offline

### 3. PhotoGallery Card -- Add Brutalist Border (`src/components/PhotoGallery.tsx`)

- Add `border-2 border-black dark:border-white` to the photo `Card` wrapper to reinforce the Minimal Brutalist aesthetic and provide a strong visual boundary during load transitions

## Files Modified

| File | Change |
|------|--------|
| `src/components/ui/optimized-image.tsx` | Add `decoding="async"`, `w-full h-full` on img, Brutalist border on skeleton |
| `src/components/PhotoGallery.tsx` | Split useEffect to prevent flash on network change; add Brutalist card border |

## What Does NOT Change

- `onPointerDownCapture` / `onClickCapture` handlers (confirmed not a cause)
- CRT shimmer CSS in `index.css` (already correct)
- Photo caching, sync, or persistence logic
- Backend, edge functions, RLS policies
- No secrets or API keys affected

