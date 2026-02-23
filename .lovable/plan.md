

## Add 8 New Background Images and Fix PWA Build Error

### Problem
The build is failing because 7 of the existing background images exceed the PWA's default 2MB precache limit (`maximumFileSizeToCacheInBytes`). Adding 8 more images will make this worse.

### Solution

**1. Fix the PWA build error (`vite-pwa-config.ts`)**
- Add `maximumFileSizeToCacheInBytes: 5 * 1024 * 1024` (5MB) to the workbox config
- This allows the larger background images to be precached for offline use

**2. Save the 8 new background images to `src/assets/backgrounds/`**

| New File | Description |
|----------|-------------|
| `bg-08-pastel-paint.png` | Pastel brushstroke sky |
| `bg-10-sunset-wave.png` | Pink/gold sunset gradient |
| `bg-11-blue-silk.png` | Blue flowing waves |
| `bg-13-pastel-hills.png` | Colorful wavy hills |
| `bg-14-crystal-mosaic.png` | Blue/red geometric mosaic |
| `bg-15-beach-grass.png` | Beach with sea grass |
| `bg-16-old-map.png` | Vintage compass map |
| `bg-17-treasure-map.png` | Treasure map with X (replaces the existing bg-17) |

**3. Update background manager (`src/lib/background-manager.ts`)**
- Add imports for the 8 new images
- Add them to the backgrounds array (total: 18 backgrounds)

### Files Changed

| File | Change |
|------|--------|
| `src/assets/backgrounds/bg-08-*.png` through `bg-17-*` | 8 new image assets |
| `src/lib/background-manager.ts` | Add 8 new imports to the array |
| `vite-pwa-config.ts` | Add `maximumFileSizeToCacheInBytes: 5 * 1024 * 1024` |

