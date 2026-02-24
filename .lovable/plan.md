

## Deploy Uploaded Logo as App Icon Across All Platforms

### Summary

Use the uploaded Rope Works logo image as the application icon for mobile PWA installs and desktop browser favicons. The image will be copied into the project and referenced from `index.html` and `manifest.json`.

### Icon Asset

The uploaded image (`Untitled_design_11.png`) -- the Rope Works knot illustration with text -- will serve as the source. It already fits the Minimal Brutalism aesthetic: high-contrast black linework on a light background, sharp edges, essential form.

### What Changes

| File / Location | Change |
|----------------|--------|
| `public/icons/` | Copy the uploaded image into the icons directory as `app-icon.png`. This single high-res source will be used for all icon contexts. |
| `public/favicon.ico` | Replace with the new icon (copy as `public/favicon.png` and update HTML reference) |
| `index.html` | Update favicon `<link>` tags to point to the new icon file. Update `apple-touch-icon` reference. |
| `public/manifest.json` | Update icon entries to reference the new image |
| `vite-pwa-config.ts` | Update the manifest icons array to match |

### Important Notes

- The uploaded image is a high-resolution PNG which will work well at all sizes. Browsers handle downscaling from a larger source for 16x16/32x32 favicon contexts.
- For maskable icons (used on Android home screens), the same image will be used. The logo's centered composition with whitespace padding makes it suitable for maskable safe zones.
- No changes to the PWA workbox caching config are needed -- icons are already covered by the existing glob patterns.

### Files to Create/Modify

1. **Copy uploaded image** to `public/icons/app-icon.png`
2. **Copy uploaded image** to `public/favicon.png` (replacing the `.ico`)
3. **`index.html`** -- Update favicon and apple-touch-icon link tags
4. **`public/manifest.json`** -- Update icon `src` paths to use `app-icon.png`
5. **`vite-pwa-config.ts`** -- Update manifest icon entries to match

