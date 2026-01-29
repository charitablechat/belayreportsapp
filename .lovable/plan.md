
# Plan: Enhance Italic Text Visibility in Rich Text Editors

## Overview
Add visual prominence to italicized text in the comment editors across all report forms by enhancing the existing CSS styling for the ProseMirror `<em>` element.

## Current State Analysis

| Report Form | Component | Editor Type | Has Italic Button |
|-------------|-----------|-------------|-------------------|
| **Inspection** | `SummarySection.tsx` | `VoiceRichTextEditor` | ✓ Yes |
| **Inspection** | `OperatingSystemsTable.tsx` | `VoiceRichTextEditor` | ✓ Yes |
| **Inspection** | `EquipmentTable.tsx` | `RichTextEditor` | ✓ Yes |
| **Inspection** | `ZiplinesTable.tsx` | `RichTextEditor` | ✓ Yes |
| **Training** | `TrainingSummarySection.tsx` | `VoiceRichTextEditor` | ✓ Yes |
| **Daily Assessment** | `SectionComments.tsx` | Plain `Textarea` | ✗ No |

**Note:** Daily Assessment forms use plain `Textarea` components without formatting buttons, so this change does not apply there.

---

## Technical Implementation

### File to Modify: `src/index.css`

**Current styling (lines 142-144):**
```css
.ProseMirror em {
  font-style: italic;
}
```

**Enhanced styling:**
```css
.ProseMirror em {
  font-style: italic;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.95);
  letter-spacing: 0.01em;
}
```

### Style Breakdown

| Property | Value | Purpose |
|----------|-------|---------|
| `font-style: italic` | Existing | Standard italic appearance |
| `font-weight: 500` | New | Subtle semi-bold weight for prominence |
| `color` | `hsl(var(--foreground) / 0.95)` | Slightly darker than standard text |
| `letter-spacing: 0.01em` | New | Subtle spacing for readability |

---

## Why This Works

1. **Single source of truth**: All `RichTextEditor` and `VoiceRichTextEditor` components render TipTap/ProseMirror, which uses `.ProseMirror em` for italics
2. **Pure CSS change**: No JavaScript or data structure modifications
3. **Respects data preservation**: The underlying HTML (`<em>` tags) remains unchanged - only visual presentation is enhanced
4. **Consistent across all reports**: The same CSS applies globally

---

## Impact Assessment

| Concern | Status |
|---------|--------|
| Data preservation | ✓ No change - `<em>` tags still saved as-is |
| Auto-save mechanism | ✓ No interference - purely visual |
| Report export (HTML/PDF) | ✓ No impact - export functions handle HTML separately |
| Dark mode | ✓ Uses CSS variables, works in both themes |

---

## Summary

| Category | Detail |
|----------|--------|
| Files Changed | 1 (`src/index.css`) |
| Lines Changed | 3 lines added to existing rule |
| Risk Level | Very Low (CSS only) |
| Testing | Apply italic formatting in any comment field and verify visual prominence |
