

## Fix Text Overflow on Mobile/Tablet Devices

### Problem
The screenshot shows a tablet (~800px wide) rendering the desktop grid view. The grid's minimum column widths total ~918px, causing horizontal overflow. Text in the "Type" column is clipped because inputs inside grid cells overflow their containers. Section headers ("HELMETS", "LANYARDS") are also cut on the left edge.

### Root Causes
1. **Grid minimum widths exceed tablet viewport** — `EQ_GRID_COLS` sums to 918px minimum, wider than most tablets in portrait
2. **Grid cells lack `min-w-0`** — child elements (inputs, selects) overflow their grid tracks
3. **No global text-wrapping safety net** — only `.ProseMirror` and `.grid > [class*="font-"]` have overflow-wrap rules; general content areas (cards, table cells, labels) do not

### Changes

#### 1. `src/index.css` — Add global text wrapping rules

Add a comprehensive safety net for all content containers:

```css
/* Global text wrapping safety net for mobile/tablet */
td, th, .card, [class*="CardContent"],
label, p, span, li, dd, dt {
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* Grid cells must allow children to shrink */
.grid > * {
  min-width: 0;
}

/* Inputs inside tight grid cells: show ellipsis cleanly */
input, select {
  text-overflow: ellipsis;
  min-width: 0;
}
```

#### 2. `src/components/inspection/EquipmentTable.tsx` — Responsive grid columns

- Add `min-w-0` to each grid cell `div` in the desktop row template
- Wrap the desktop grid in `overflow-x-auto` so tablets can scroll horizontally if needed instead of clipping content off-screen
- Reduce some column minimums for tablet friendliness:
  - Type: `minmax(120px, 1fr)` (was 160px)
  - Result: `160px` (was 192px)

#### 3. `src/components/inspection/OperatingSystemsTable.tsx` — Same pattern
- Wrap desktop grid in `overflow-x-auto`
- Add `min-w-0` to grid cells

#### 4. `src/components/inspection/ZiplinesTable.tsx` — Same pattern
- Already has many columns; wrap in `overflow-x-auto` for horizontal scroll on tablets

#### 5. `src/components/ui/card.tsx` — Add overflow protection
- Add `overflow-hidden` to base Card component to prevent children from breaking out of card boundaries

### Result
- All text wraps or truncates cleanly within its container on all screen sizes
- Tablet users get horizontal scroll on wide tables instead of invisible content overflow
- Global CSS rules prevent any future text overflow regressions across the app

