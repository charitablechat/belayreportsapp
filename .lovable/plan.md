

## Fix: Responsive Text Wrapping for Inspection Report Headers

### Problem
From the screenshots, header text like "Comments and/or Required Changes" overflows/clips on tablet devices. The table header cells and the main report title need proper word-wrapping on all screen sizes.

### Changes

**1. `src/components/inspection/InspectionHeader.tsx` (line 71-72)**
Add overflow and word-break guards to the title:
```html
<div className="text-center overflow-hidden">
  <h1 className="text-xl md:text-2xl font-bold mb-2 px-2 md:px-0 break-words [overflow-wrap:anywhere]">
```

**2. `src/components/inspection/EquipmentTable.tsx` (line 351)**
Add `break-words` to the "Comments and/or Required Changes" header cell:
```html
<div className="p-3 text-left font-semibold text-sm border-r border-border break-words">Comments and/or Required Changes</div>
```
Also add `break-words` to "Manufacture Year(s)" header (line 348).

**3. `src/components/inspection/OperatingSystemsTable.tsx` (line 128)**
Same — add `break-words` to the Comments header cell.

**4. `src/components/inspection/ZiplinesTable.tsx` (line 130)**
Add `break-words` to the Comments header cell.

**5. Global safety net in `src/index.css`**
Add a rule ensuring all grid/table header text wraps:
```css
.grid > [class*="font-semibold"] {
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

### Files
| File | Change |
|------|--------|
| `InspectionHeader.tsx` | `break-words [overflow-wrap:anywhere]` on title, `overflow-hidden` on wrapper |
| `EquipmentTable.tsx` | `break-words` on long header cells |
| `OperatingSystemsTable.tsx` | `break-words` on Comments header |
| `ZiplinesTable.tsx` | `break-words` on Comments header |
| `src/index.css` | Global grid header word-break rule |

