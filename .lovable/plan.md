## Plan: Swap sign-in page background

**Change:** Replace the current sign-in background image with the uploaded forest/inspector photo. The sign-in layout, glass card, logo, form, and all auth logic stay untouched.

### Steps

1. Upload the new image to Lovable Assets CDN:
   ```
   lovable-assets create --file /mnt/user-uploads/ChatGPT_Image_Jun_15_2026_10_35_47_PM.png \
     --filename signin-bg-forest.png > src/assets/signin-bg-forest.png.asset.json
   ```
2. In `src/components/Auth.tsx`, change the background import from `signin-bg-new.png.asset.json` to the new `signin-bg-forest.png.asset.json` pointer. No other code changes.
3. Optionally adjust the `object-[35%_center]` focal-point class so the inspector subject stays visible at common viewport sizes (will verify visually after swap; default to `object-center` if the current crop hides her).
4. Delete the now-unused old asset pointer (`src/assets/signin-bg-new.png.asset.json`) via `assets--delete_asset` to keep the repo clean. Older `signin-bg.jpg/.png` pointers are left alone since they may still be referenced elsewhere — I'll grep to confirm before deleting any.

### Not changing
- Auth flow, offline sign-in, guest mode, password reset
- Glass card styling, Belay Reports logo, form fields
- Any other page, route, edge function, or migration

### Verification
- Load `/` in preview, confirm the forest photo renders full-bleed behind the glass card with the subject visible and the form readable.
