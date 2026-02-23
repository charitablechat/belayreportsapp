

## Add 4-Leaf Clover Sparkles Back to Cards and Buttons

### What Changes

**1. Update Sparkles component (`src/components/christmas/Sparkles.tsx`)**
- Replace the star-burst SVG path with a 4-leaf clover shape (four overlapping heart/leaf petals arranged in a cross pattern)
- Update the color palette to green/gold St. Patrick's Day tones:
  - Emerald green, lime green, gold, white, dark green
- Keep all existing hooks and logic (`useSparkles`, `useHoverSparkles`, `useClickAndHoverSparkles`, `SparkleContainer`) exactly as-is

**2. Re-add sparkles to ReportCard (`src/components/dashboard/ReportCard.tsx`)**
- Import `useClickAndHoverSparkles` and `SparkleContainer` from Sparkles
- Add the hook call in the component
- Wire `triggerSparkles` into the card's `onClick` and `handleMouseMove` onto `onMouseMove`
- Render `<SparkleContainer />` inside the component

**3. Re-add sparkles to GradientButton (`src/components/ui/gradient-button.tsx`)**
- Import `useClickAndHoverSparkles` and `SparkleContainer` from Sparkles
- Add the hook call in the forwarded-ref component
- Wire sparkle events onto the button element
- Render `<SparkleContainer />` alongside the button

### Technical Details

The 4-leaf clover SVG will use four elliptical leaf shapes rotated at 0, 90, 180, and 270 degrees around a center point, with a small stem line. The viewBox remains `0 0 24 24` for drop-in compatibility.

| File | Changes |
|------|---------|
| `src/components/christmas/Sparkles.tsx` | Clover SVG path, green color palette |
| `src/components/dashboard/ReportCard.tsx` | Re-add sparkle imports and hook usage |
| `src/components/ui/gradient-button.tsx` | Re-add sparkle imports and hook usage |

