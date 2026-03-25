

## Fix: Vertical Text Rendering in Table Headers on iPad

### Root Cause

The "Comments and/or Required Changes" column in OperatingSystemsTable and EquipmentTable uses a bare `1fr` grid track with no minimum width:

```text
OS:  grid-cols-[40px_88px_minmax(180px,1fr)_minmax(160px,1fr)_192px_1fr_64px]
                                                                    ^^^
EQ:  grid-cols-[40px_88px_minmax(160px,1fr)_128px_96px_192px_1fr_64px]
                                                             ^^^
```

On iPad (~1024px CSS width), the other `minmax(..., 1fr)` columns expand greedily, leaving the Comments `1fr` column with near-zero width. The text wraps per-character, producing the vertical rendering seen in the screenshot.

ZiplinesTable already uses `minmax(120px, 1fr)` for its Comments column — it does not have this bug.

### Fix

**1. `src/components/inspection/OperatingSystemsTable.tsx` — line 33**
Change the Comments column from bare `1fr` to `minmax(150px, 1fr)`:
```
grid-cols-[40px_88px_minmax(180px,1fr)_minmax(160px,1fr)_192px_minmax(150px,1fr)_64px]
```

**2. `src/components/inspection/EquipmentTable.tsx` — line 37**
Same fix:
```
grid-cols-[40px_88px_minmax(160px,1fr)_128px_96px_192px_minmax(150px,1fr)_64px]
```

**3. Both files — Comments header cells and data cells**
Add `min-w-0` class alongside existing `break-words` to allow CSS Grid children to shrink below intrinsic content width. Add `[overflow-wrap:anywhere]` for aggressive wrapping at any character boundary when space is tight.

**4. `src/index.css` — Global safety net**
Add a rule targeting all grid children with font-semibold (header cells) to enforce `min-width: 0` and `overflow-wrap: anywhere`, preventing any future grid column from exhibiting this behavior.

### Files
| File | Change |
|------|--------|
| `OperatingSystemsTable.tsx` | `1fr` → `minmax(150px, 1fr)` for Comments column; add `min-w-0 [overflow-wrap:anywhere]` to header/cells |
| `EquipmentTable.tsx` | Same grid fix; same class additions |
| `src/index.css` | Global `min-w-0` + `overflow-wrap` safety net for grid header cells |

