

## Make Photo Gallery 2-Column in Both HTML and Print/PDF

### Problem
The photo gallery currently uses `grid-template-columns: 1fr` (single column) everywhere -- base styles, mobile media query, and print media query. The user wants a 2-column layout in both the HTML view and the PDF output.

### File: `supabase/functions/generate-inspection-html/index.ts`

**1. Base styles (line 1490):** Change `grid-template-columns: 1fr` to `repeat(2, 1fr)`. Reduce gap from 30px to 20px, increase max-width from 80% to 90%.

**2. Photo item (line 1505):** Reduce padding from 16px to 12px so images use more card space.

**3. Photo image (line 1510):** Reduce max-height from 350px to 280px for better side-by-side sizing.

**4. Print media query (lines 1541-1548):** Change `grid-template-columns: 1fr` to `repeat(2, 1fr)` so PDF also gets 2 columns. Increase max-width from 85% to 92%.

**5. Early print override (lines 1267-1270):** Change `display: block !important` to `display: grid !important` so it doesn't accidentally flatten the grid back to block layout.

**6. Mobile media query (lines 1474-1479):** Keep `grid-template-columns: 1fr` for small screens -- single column is correct on mobile.

### Deployment
Redeploy `generate-inspection-html` after changes.

