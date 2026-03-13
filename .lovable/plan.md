

## Replace Dashboard Backgrounds

### What Changes

Remove all 17 existing background images from `src/assets/backgrounds/` and replace with the 10 uploaded images. Update `src/lib/background-manager.ts` to import only the new set.

### Files

**Copy 10 uploaded images** into `src/assets/backgrounds/`:
1. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_3-2.png` → `bg-01-marble-gold.png`
2. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_4-2.png` → `bg-02-wood-planks.png`
3. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_5-2.png` → `bg-03-wood-rings.png`
4. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_6-2.png` → `bg-04-wood-tiles.png`
5. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_9-2.png` → `bg-05-gold-water.png`
6. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_10-2.png` → `bg-06-sunset-wave.png`
7. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_11-2.png` → `bg-07-blue-silk.png`
8. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_12-2.png` → `bg-08-pool-tiles.png`
9. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper_18.png` → `bg-09-topo-lines.png`
10. `Pink_and_Beige_Marble_Textured_Background_Motivational_Desktop_Wallpaper-2.png` → `bg-10-marble-pink.png`

**Delete** all old background files that aren't overwritten by the new names (bg-01 through bg-04/05/06 get overwritten; the rest like bg-07-bamboo, bg-08-pastel-paint, bg-09-gold-water, bg-10 through bg-17 get deleted).

**Update `src/lib/background-manager.ts`:** Replace all imports to reference only the 10 new files, update the `backgrounds` array.

### Technical Detail
- Reusing some filenames (bg-01 through bg-05) means those old files get replaced in-place by the copy operation.
- Old files with names not reused (bg-07-bamboo, bg-08-pastel-paint, bg-10-sunset-wave, bg-11 through bg-17) need explicit deletion.
- The `getSessionBackground()` logic remains unchanged -- just the pool of images changes.

