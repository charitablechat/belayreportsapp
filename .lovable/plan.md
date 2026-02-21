

## Refactor: Constrain Photo Images in Generated HTML Reports

### Problem

Photos in generated inspection reports render at full, unconstrained width -- they stretch edge-to-edge across the viewport, dominating the page and pushing content off-screen on mobile. The screenshot confirms images have no effective size cap and overflow their containers.

### Root Cause

In `supabase/functions/generate-inspection-html/index.ts`, the `.inspection-photo` class uses `width: 100%` with `max-height: 300px` and `object-fit: cover`. On wide screens, this stretches photos to the full container width (which is the full page). On mobile, the single-column grid means each photo takes up the entire screen width. The `object-fit: cover` crops aggressively rather than fitting the image naturally.

### Solution

Update the photo gallery CSS in the backend edge function to constrain images with a reasonable max size, use `object-fit: contain` for natural proportions, and apply Minimal Brutalist styling (strong borders, clear hierarchy).

### File Changes

**`supabase/functions/generate-inspection-html/index.ts`**

Update three CSS blocks:

1. **`.photo-gallery`** (line ~1481): Keep 2-column grid on desktop but add `max-width: 100%`

2. **`.inspection-photo`** (line ~1498): Change from unconstrained cover to contained sizing:
   - `max-width: 100%` and `max-height: 280px` with `object-fit: contain` (show full image, no cropping)
   - `margin: 0 auto` to center smaller images
   - `background: #f8fafc` behind the image to fill empty space cleanly

3. **`.photo-item`** (line ~1489): Add a stronger Brutalist border (`2px solid #1e293b`) and remove the rounded corners for the Minimal Brutalist look

4. **`.photo-section-label`** (line ~1513): Strengthen with a left border accent (`border-left: 3px solid #1e40af`)

5. **Mobile media query** (line ~1473): Ensure `.inspection-photo` on mobile gets `max-height: 220px` so photos don't dominate small screens

6. **Print media query** (line ~1525): Update `.inspection-photo` to use `max-height: 280px` with `object-fit: contain` to match screen rendering, ensuring print output shows full images without cropping

7. **HtmlReportViewer.tsx mobile styles**: Update the injected mobile CSS to include matching photo constraints (`.inspection-photo { max-height: 220px; object-fit: contain; }`) for consistency in the in-app viewer

No changes to report generation logic, photo encoding, or print toolbar behavior.
