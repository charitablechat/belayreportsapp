

# Plan: Fix Mobile Report Viewer Text Overlap and Clipping (v2.2.97)

## Problem Summary

When viewing generated reports in the `HtmlReportViewer` on mobile viewports (< 600px), text is overlapping and clipping, preventing proper readability. The current mobile styles injected into the iframe are minimal and don't adequately address the responsive layout issues.

## Root Cause Analysis

### 1. Insufficient Mobile Style Injection
The current `mobileBaseStyles` in `HtmlReportViewer.tsx` only includes:
```css
html, body { max-width: 100vw; overflow-x: hidden; }
* { box-sizing: border-box; }
```

This is insufficient for proper mobile rendering - it prevents horizontal scroll but doesn't fix:
- Text/element overlap in headers
- Table content clipping
- Info grid layout compression
- Footer text wrapping issues

### 2. Report CSS Mobile Breakpoints Incomplete
The report HTML templates have mobile media queries at 768px and 480px, but they're missing critical fixes for:
- Header logo/title overlap on narrow screens
- Table cells forcing text into tiny, overlapping spaces
- Footer disclaimer text wrapping and centering
- Info grid label/value alignment

### 3. Specific Issues Identified

| Element | Problem | Cause |
|---------|---------|-------|
| Header | Logos + title overlap | `flex-direction: row` + insufficient spacing |
| Info Grid | Labels/values overlap | Fixed `flex-shrink: 0` on labels |
| Tables | Content clipped/overlapping | `min-width` forces horizontal scroll but cells compress |
| Footer | Disclaimer text overlaps | `max-width: 75%` restricts width on mobile |
| Text blocks | Text truncation | Insufficient `word-break` handling |

## Solution

### Two-Part Fix:

1. **Enhanced Mobile Styles in HtmlReportViewer** - Inject comprehensive mobile-specific CSS overrides that target all problematic elements
2. **Improved Edge Function Mobile CSS** - Add missing mobile breakpoint rules to all three report generators

### Fix 1: Enhanced Mobile Styles in HtmlReportViewer.tsx

Add a comprehensive mobile style block that addresses all identified issues:

```css
/* Mobile viewport override styles (injected by HtmlReportViewer) */
@media screen and (max-width: 600px) {
  /* Prevent any horizontal overflow */
  html, body, .page, .page-content {
    max-width: 100vw !important;
    overflow-x: hidden !important;
    overflow-wrap: break-word !important;
    word-wrap: break-word !important;
  }
  
  /* Header: Stack logos and title vertically */
  .page-header {
    flex-direction: column !important;
    align-items: center !important;
    gap: 8px !important;
    padding-bottom: 8px !important;
  }
  
  .header-left, .header-right, .header-center {
    position: static !important;
    transform: none !important;
    text-align: center !important;
  }
  
  .header-title {
    max-width: 100% !important;
    font-size: 8pt !important;
    white-space: normal !important;
  }
  
  /* Table layout for header logos - allow cell wrapping on mobile */
  .header-logo-table {
    table-layout: auto !important;
  }
  
  .header-cell-left, .header-cell-right {
    display: block !important;
    width: 100% !important;
    text-align: center !important;
    padding: 4px 0 !important;
  }
  
  /* Info grid: Single column with proper spacing */
  .info-grid {
    display: block !important;
    grid-template-columns: 1fr !important;
  }
  
  .info-cell {
    display: block !important;
    margin-bottom: 12px !important;
  }
  
  .info-label {
    display: block !important;
    white-space: normal !important;
    margin-bottom: 4px !important;
  }
  
  .info-value {
    display: block !important;
    word-break: break-word !important;
  }
  
  /* Tables: Force readable text */
  table {
    font-size: 8pt !important;
    table-layout: auto !important;
  }
  
  th, td {
    padding: 4px !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
  }
  
  /* Prevent nowrap from causing overlap */
  .result-checkbox, td, th {
    white-space: normal !important;
  }
  
  /* Footer: Full width disclaimer */
  .disclaimer, .footer-disclaimer {
    max-width: 100% !important;
    font-size: 7pt !important;
    padding: 0 8px !important;
  }
  
  /* Titles: Prevent clipping */
  h1 { font-size: 16pt !important; word-break: break-word !important; }
  h2 { font-size: 12pt !important; padding: 6px 8px !important; }
  h3 { font-size: 10pt !important; }
  
  /* Text blocks */
  .text-block, .text-content, .key-section {
    word-break: break-word !important;
    overflow-wrap: break-word !important;
  }
  
  /* Photo gallery: Single column */
  .photo-gallery {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
  }
}
```

### Fix 2: Edge Function Mobile CSS Improvements

Update all three report generators with enhanced mobile breakpoint CSS:

**Files:**
- `supabase/functions/generate-inspection-html/index.ts`
- `supabase/functions/generate-training-html/index.ts`
- `supabase/functions/generate-daily-assessment-html/index.ts`

Add/update the `@media screen and (max-width: 600px)` breakpoint with:
- `white-space: normal !important` on all table cells
- `word-break: break-word` on text containers
- Header flexbox to column direction
- Footer disclaimer full width

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/HtmlReportViewer.tsx` | Modify | Inject comprehensive mobile CSS overrides |
| `supabase/functions/generate-inspection-html/index.ts` | Modify | Add 600px breakpoint with enhanced mobile rules |
| `supabase/functions/generate-training-html/index.ts` | Modify | Add 600px breakpoint with enhanced mobile rules |
| `supabase/functions/generate-daily-assessment-html/index.ts` | Modify | Add 600px breakpoint with enhanced mobile rules |
| `vite.config.ts` | Modify | Version bump to 2.2.97 |

---

## Implementation Details

### HtmlReportViewer.tsx Changes

Replace the minimal `mobileBaseStyles` block with comprehensive mobile styles:

```typescript
// Add mobile base styles to ensure viewport consistency and prevent overlap/clipping
const mobileBaseStyles = `
  <style>
    /* Base reset */
    html, body {
      max-width: 100vw !important;
      overflow-x: hidden !important;
    }
    * {
      box-sizing: border-box !important;
    }
    
    /* Mobile viewport fixes (< 600px) - Minimal Brutalism style */
    @media screen and (max-width: 600px) {
      /* Global overflow prevention */
      html, body, .page, .page-content {
        max-width: 100vw !important;
        overflow-x: hidden !important;
        overflow-wrap: break-word !important;
        word-wrap: break-word !important;
      }
      
      /* Header: Stack vertically to prevent overlap */
      .page-header {
        flex-direction: column !important;
        align-items: center !important;
        gap: 8px !important;
        padding-bottom: 10px !important;
        min-height: auto !important;
        max-height: none !important;
      }
      
      .header-left, .header-right, .header-center {
        position: static !important;
        transform: none !important;
        text-align: center !important;
        width: 100% !important;
      }
      
      .header-title {
        max-width: 100% !important;
        font-size: 8pt !important;
        white-space: normal !important;
      }
      
      /* Table-based header logos - stack on mobile */
      .header-logo-table {
        table-layout: auto !important;
      }
      
      .header-logo-table tr {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 8px !important;
      }
      
      .header-cell-left, .header-cell-right {
        display: block !important;
        width: 100% !important;
        text-align: center !important;
        padding: 4px 0 !important;
      }
      
      /* Info grid: Single column with clear separation */
      .info-grid {
        display: block !important;
      }
      
      .info-cell, .info-item {
        display: block !important;
        margin-bottom: 12px !important;
        border-bottom: 1px solid #e5e7eb !important;
        padding-bottom: 8px !important;
      }
      
      .info-label {
        display: block !important;
        white-space: normal !important;
        margin-bottom: 4px !important;
        font-weight: 700 !important;
      }
      
      .info-value {
        display: block !important;
        word-break: break-word !important;
        border-bottom: none !important;
      }
      
      /* Tables: Prevent content overlap */
      table {
        font-size: 8pt !important;
        table-layout: auto !important;
        width: 100% !important;
      }
      
      th, td {
        padding: 4px 6px !important;
        word-break: break-word !important;
        overflow-wrap: break-word !important;
        white-space: normal !important;
        max-width: none !important;
      }
      
      .result-checkbox {
        white-space: normal !important;
        font-size: 7pt !important;
        line-height: 1.3 !important;
      }
      
      /* Footer: Full width, no clipping */
      .page-footer {
        margin-top: 16px !important;
      }
      
      .disclaimer, .footer-disclaimer {
        max-width: 100% !important;
        font-size: 7pt !important;
        padding: 0 4px !important;
        text-align: center !important;
      }
      
      /* Typography: Prevent clipping */
      h1 { 
        font-size: 16pt !important; 
        word-break: break-word !important;
        line-height: 1.3 !important;
      }
      h2 { 
        font-size: 12pt !important; 
        padding: 6px 8px !important;
        word-break: break-word !important;
      }
      h3 { 
        font-size: 10pt !important;
        word-break: break-word !important;
      }
      
      /* Text containers */
      .text-block, .text-content, .key-section, .critical-box, .standards-box {
        word-break: break-word !important;
        overflow-wrap: break-word !important;
        padding: 8px !important;
      }
      
      /* Bullet lists */
      .bullet-list, .summary-list, ul {
        padding-left: 16px !important;
        margin-left: 0 !important;
      }
      
      .bullet-list li, .summary-list li, ul li {
        word-break: break-word !important;
        font-size: 9pt !important;
        line-height: 1.4 !important;
      }
      
      /* Photo gallery: Single column */
      .photo-gallery {
        grid-template-columns: 1fr !important;
        gap: 12px !important;
      }
      
      .photo-item {
        width: 100% !important;
      }
      
      /* Systems/checklist grids */
      .systems-grid {
        grid-template-columns: 1fr !important;
      }
    }
  </style>
`;
```

---

## Visual Design Notes (Minimal Brutalism)

The mobile fixes maintain the **Minimal Brutalism** aesthetic established in v2.2.92:
- **High contrast**: Black text on white, bold headers
- **Clear separation**: Border-bottom on info items, clear section breaks
- **Functional over decorative**: No shadows or gradients, simple borders
- **Direct legibility**: Larger touch targets, readable font sizes (minimum 7pt)

---

## Testing Checklist

1. **Inspection Report on mobile (< 600px)** - No text overlap in header, tables readable
2. **Training Report on mobile** - Info grid items stack properly, no clipping
3. **Daily Assessment on mobile** - Checklist items fully visible
4. **Desktop view unchanged** - No regression in desktop layout
5. **Pinch-to-zoom works** - Touch actions preserved on iframe
6. **Footer readable** - Disclaimer text wraps correctly
7. **Tables scrollable** - Complex tables allow horizontal scroll when needed
8. **Photos display correctly** - Single column on mobile, no overlap

---

## Data Integrity

These changes:
- Do **NOT** modify database operations
- Do **NOT** affect PDF generation
- Do **NOT** change report data structure
- **ONLY** add CSS overrides for mobile viewport rendering

