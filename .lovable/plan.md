

# Replace Falling Hearts with Winter Olympic Decorations

## Overview

Remove the `FallingHearts` component from the Dashboard and replace it with Winter Olympic-themed decorations. Keep the Valentine's Day countdown banner (`HolidayBanner`) intact. Replace the `HeartsBorder` on report cards with a subtle winter/Olympic accent. Add a new `FallingSnowflakes` component (reusing the existing `Snowfall` component pattern) and small Olympic ring accents.

## Changes

### 1. Dashboard (`src/pages/Dashboard.tsx`)

**Remove** `FallingHearts` import (line 43) and its render (line 774).

**Add** imports for new components:
- `import { Snowfall } from "@/components/christmas/Snowfall"` (already exists)
- `import { OlympicRings } from "@/components/christmas/OlympicRings"` (new)

**Replace** `<FallingHearts />` at line 774 with `<Snowfall />`.

**Replace** the three `<HeartsBorder />` instances on the foyer cards (lines 916, 943, 970) with `<OlympicRings />` -- a subtle decorative border using the five Olympic ring colors.

**Remove** the pink/rose gradient overlays on foyer cards:
- Line 917: `from-pink-50` becomes `from-blue-50/30`
- Line 944: `from-rose-50` becomes `from-sky-50/30`
- Line 971: `from-red-50` becomes `from-indigo-50/30`

**Remove** `valentine-card-glow` class from any card classNames if present in the report cards area.

### 2. New Component: `src/components/christmas/OlympicRings.tsx`

A small decorative SVG border component that replaces `HeartsBorder`. Renders five interlocking rings in the official Olympic colors (blue, yellow, black, green, red) as a subtle top accent on cards. Similar structure to `HeartsBorder` -- an absolutely positioned SVG at the top of the card.

```tsx
export function OlympicRings({ className = "" }) {
  const colors = ["#0081C8", "#FCB131", "#000000", "#00A651", "#EE334E"];
  return (
    <div className={`absolute -top-1 left-0 right-0 pointer-events-none z-10 flex justify-center ${className}`}>
      <svg viewBox="0 0 120 30" className="w-24 h-6 opacity-60">
        {/* Five interlocking circles */}
        {colors.map((color, i) => (
          <circle
            key={i}
            cx={18 + i * 22}
            cy={i % 2 === 0 ? 12 : 18}
            r={9}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
}
```

### 3. CSS Updates (`src/index.css`)

No new keyframes needed -- `Snowfall` already has its `@keyframes snowfall` defined. The existing snowfall animation and the `animate-snowfall` class are already in place.

### 4. Report Cards (`src/components/dashboard/ReportCard.tsx`)

**Remove** the `HeartsBorder` import (line 15) and its render inside the card.

**Remove** `valentine-card-glow` from the Card className (line 106). Replace with standard shadow styling.

**Keep** the sparkle effects (those are interactive, not Valentine-specific per se -- can remain as winter sparkles).

### 5. HolidayBanner -- NO CHANGES

The Valentine's Day countdown banner stays exactly as-is. It has its own self-contained valentine-gradient styling and candy hearts.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Swap `FallingHearts` for `Snowfall`, swap `HeartsBorder` for `OlympicRings`, update gradient tints |
| `src/components/christmas/OlympicRings.tsx` | **New** -- Olympic rings decorative border |
| `src/components/dashboard/ReportCard.tsx` | Remove `HeartsBorder` and `valentine-card-glow` |

## What Does NOT Change

- `HolidayBanner` (Valentine's countdown) -- kept as-is
- All sync logic, data fetching, authentication
- Sparkle effects on buttons/cards (kept as winter sparkles)
- Valentine confetti on report completion (separate concern -- can be addressed later if desired)
- `FallingHearts.tsx`, `HeartsBorder.tsx` files remain in codebase (just not rendered)

