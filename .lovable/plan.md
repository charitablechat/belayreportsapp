

# Fix Plan: Pictures Being Cut Off in Generated Reports

## Problem Summary
Photos in generated inspection reports are being cut off because the `.page` and `.page-content` CSS classes have strict height constraints and `overflow: hidden` that clips any content exceeding the page bounds.

## Root Cause Analysis

### Current Problematic CSS in `generate-inspection-html/index.ts`

**Screen CSS (lines 481-496):**
```css
.page {
  min-height: 9in;
  max-height: 9.5in;     /* <-- PROBLEM: Strict max height */
  overflow: hidden;       /* <-- PROBLEM: Clips content */
}

.page-content {
  flex: 1;
  overflow: hidden;       /* <-- PROBLEM: Clips photos */
}
```

**Print CSS (lines 970-988):**
```css
.page {
  height: 9.5in !important;
  max-height: 9.5in !important;
  overflow: hidden !important;   /* <-- PROBLEM: Clips in PDF */
}

.page-content {
  overflow: visible !important;  /* <-- Already fixed for print, but .page still clips */
}
```

### Why Training/Daily Reports Don't Have This Issue
The training and daily assessment generators were previously fixed with explicit comments:
```css
/* Page structure - NO FIXED HEIGHTS, NO OVERFLOW HIDDEN
 * Content flows naturally and browser handles pagination
 */
.page {
  /* CRITICAL: No max-height, no overflow:hidden */
}
```

## Solution

Apply the same fix that was already implemented in the training and daily assessment generators to the inspection HTML generator.

---

## Implementation Steps

### Step 1: Fix Screen CSS (lines 481-496)

**Before:**
```css
.page {
  display: flex;
  flex-direction: column;
  min-height: 9in;
  max-height: 9.5in;
  padding: 0.25in;
  page-break-after: always;
  page-break-inside: avoid;
  overflow: hidden;
  box-sizing: border-box;
}

.page-content {
  flex: 1;
  overflow: hidden;
}
```

**After:**
```css
/* 
 * Page structure - NO FIXED HEIGHTS, NO OVERFLOW HIDDEN
 * Content flows naturally and browser handles pagination
 */
.page {
  display: flex;
  flex-direction: column;
  min-height: auto;
  padding: 0.25in;
  page-break-after: always;
  page-break-inside: avoid;
  box-sizing: border-box;
  /* CRITICAL: No max-height, no overflow:hidden - allows photos to render fully */
}

.page-content {
  flex: 1;
  /* No overflow:hidden - content must flow naturally */
}
```

### Step 2: Fix Print CSS (lines 970-988)

**Before:**
```css
.page {
  display: flex !important;
  flex-direction: column !important;
  min-height: 9in !important;
  height: 9.5in !important;
  max-height: 9.5in !important;
  padding: 0.2in !important;
  margin: 0 !important;
  box-sizing: border-box !important;
  page-break-after: always !important;
  page-break-inside: avoid !important;
  overflow: hidden !important;
}
```

**After:**
```css
/* 
 * PRINT: Page structure - content flows naturally
 * Browser handles pagination automatically
 */
.page {
  display: block !important;
  min-height: auto !important;
  height: auto !important;
  max-height: none !important;
  padding: 0.2in !important;
  margin: 0 !important;
  box-sizing: border-box !important;
  page-break-after: always !important;
  page-break-inside: auto !important;
  overflow: visible !important;
}

.page-content {
  display: block !important;
  overflow: visible !important;
}
```

### Step 3: Enhance Photo Gallery CSS for Better Flow

Add explicit photo flow styles to ensure gallery spans multiple pages if needed:

```css
/* Photo Gallery - allow natural flow across pages */
.photo-gallery {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 15px;
  margin: 15px 0;
  overflow: visible;
}

.photo-item {
  page-break-inside: avoid;
  break-inside: avoid;
  overflow: visible;
}

.inspection-photo {
  width: 100%;
  height: auto;           /* Changed from max-height: 250px */
  max-width: 100%;
  object-fit: contain;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: block;
}

@media print {
  .photo-gallery {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    overflow: visible !important;
  }

  .inspection-photo {
    height: auto !important;
    max-height: none !important;  /* Remove max-height constraint */
    display: block !important;
    visibility: visible !important;
  }

  .photo-item {
    page-break-inside: avoid;
    break-inside: avoid;
    overflow: visible !important;
  }
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/generate-inspection-html/index.ts` | Remove `overflow: hidden` and `max-height` from `.page` and `.page-content` in both screen and print CSS; Update photo gallery styles to use `height: auto` |

---

## Expected Outcome

After these changes:
- Photos will render completely without being cut off
- Photo galleries that exceed a single page will flow naturally to the next page
- The fix aligns inspection reports with the already-working training and daily assessment reports
- PDF exports will correctly display all photos in full

---

## Technical Notes

- This fix follows the pattern already established in `generate-training-html/index.ts` (lines 108-151) and `generate-daily-assessment-html/index.ts` (lines 174-217)
- The browser's native pagination handles page breaks when content flows naturally
- `page-break-inside: avoid` on `.photo-item` ensures individual photos don't split across pages
- No database or frontend changes required - this is purely a CSS fix in the edge function

