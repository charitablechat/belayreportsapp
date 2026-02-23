## Replace Background and Remove Olympic Decorations

### 1. Add the new background image

Copy the uploaded blue wave image to `src/assets/app-background.png` for use as the background across all pages.

### 2. Replace backgrounds on all pages

**Dashboard (`src/pages/Dashboard.tsx`)**

- Replace `dashboardBackground` (webp image) with the new blue wave image
- Remove the `OlympicRings` import and all 3 uses on the foyer cards (lines 1104, 1131, 1158)

### 3. Remove all Olympic decorations

**Dashboard (`src/pages/Dashboard.tsx`)**

- Remove `OlympicRings` import (line 44)
- Remove 3 `<OlympicRings />` instances from the foyer cards

**ReportCard (`src/components/dashboard/ReportCard.tsx`)**

- Remove `OlympicRings` import and `<OlympicRings />` usage (line 143)

### 4. Files NOT deleted

The `src/components/christmas/` folder (OlympicRings, Sparkles, Icicles, SnowPile, ChristmasLights) will remain in the codebase but will no longer be imported anywhere. This keeps the code available if seasonal decorations are ever wanted again.

### Summary of touched files


| File                                      | Changes                                        |
| ----------------------------------------- | ---------------------------------------------- |
| `src/assets/app-background.png`           | New file (uploaded image)                      |
| `src/components/Auth.tsx`                 | Video background replaced with static image    |
| `src/pages/Dashboard.tsx`                 | Background image swapped, OlympicRings removed |
| `src/pages/AuroraLanding.tsx`             | Video background replaced with static image    |
| `src/components/dashboard/ReportCard.tsx` | OlympicRings and Sparkles removed              |
| `src/components/ui/gradient-button.tsx`   | Sparkles removed                               |
