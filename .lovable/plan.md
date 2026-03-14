

## Fix Manufacture Year(s) Field Layout

### Problem
The year input and N/A button sit side-by-side in a narrow column, causing year ranges like "2024-2026" to be truncated.

### Solution
Stack the input and N/A button vertically instead of horizontally, in both desktop and mobile views.

### Changes — `src/components/inspection/EquipmentTable.tsx`

**Desktop (lines 380-412):**
- Change the wrapper from `flex items-center gap-1` to `flex flex-col gap-1`
- Input gets full width, placeholder updated to "e.g. 2018-2026"
- N/A button moves below the input, rendered as a small full-width button

**Mobile (lines 498-520):**
- Same vertical stacking: input on top, N/A button below
- Input gets full width instead of sharing row with N/A button

### Visual Result
```text
┌──────────────┐
│ 2024-2026    │  ← full-width input, no truncation
├──────────────┤
│    [ N/A ]   │  ← button below
└──────────────┘
```

