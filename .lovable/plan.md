

# Change "INVOICED" Watermark Color from Green to Red

## Summary
Change only the text and border/glow color of the "INVOICED" watermark stamp on report cards from emerald/green to red. No other changes.

## Change

### `src/components/dashboard/ReportCard.tsx` (~line 168-171)
Replace emerald color classes with red equivalents in the INVOICED span:

- `bg-emerald-500/10` → `bg-red-500/10`
- `border-emerald-400/30` → `border-red-400/30`
- `text-emerald-600` → `text-red-600`
- `dark:text-emerald-400` → `dark:text-red-400`
- `shadow-[0_0_20px_rgba(16,185,129,0.25)]` → `shadow-[0_0_20px_rgba(239,68,68,0.25)]`

Everything else (animation, size, rotation, blur, positioning) stays identical.

