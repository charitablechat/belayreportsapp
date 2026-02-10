

# Fix Olympic Rings to Match Official Design

## Problem

The current `OlympicRings` SVG uses simple non-interlocking circles. The official Olympic rings have a specific **interlocking pattern** where bottom-row rings weave over and under top-row rings.

## Solution

Rewrite the SVG in `src/components/christmas/OlympicRings.tsx` to use proper interlocking. This requires drawing rings in layers with **clip paths** to create the over-under weave effect:

- **Top row**: Blue (left), Black (center), Red (right)
- **Bottom row**: Yellow (between blue/black), Green (between black/red)
- **Interlocking**: Yellow passes *over* blue but *under* black. Green passes *over* black but *under* red.

The technique: draw each ring as a full circle, then redraw specific arc segments on top to create the illusion of interlocking. This is the standard SVG approach for the Olympic rings.

## Layout Geometry

Using a viewBox of `0 0 504 228`:
- Ring radius: 72, stroke width: 10
- Top row Y center: 82; Bottom row Y center: 146
- Horizontal spacing: ~84px between ring centers

## File Changed

| File | Change |
|------|--------|
| `src/components/christmas/OlympicRings.tsx` | Rewrite SVG with proper interlocking rings using layered arcs |

## What Does NOT Change

- Component props interface (className still accepted)
- Positioning classes (absolute, pointer-events-none, z-10)
- All usages in Dashboard and ReportCard remain the same
- No other files modified

