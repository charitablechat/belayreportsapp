

## Add Divider Rows to Equipment Sections

### Overview
Add divider row support to all equipment tables, mirroring the existing implementation in the Operating Systems table. This includes a database migration, UI changes, and report generation updates.

### Changes

**1. Database Migration**
Add `is_divider` (boolean, default false) and `divider_text` (text, nullable) columns to `inspection_equipment`.

```sql
ALTER TABLE public.inspection_equipment 
  ADD COLUMN is_divider boolean NOT NULL DEFAULT false,
  ADD COLUMN divider_text text;
```

**2. `src/components/inspection/EquipmentTable.tsx`**
- Import `Minus` icon
- Add `addDivider` callback that inserts a new row with `is_divider: true`, `divider_text: ""`, `equipment_type: ""`, `result: "pass"` (to satisfy NOT NULL)
- Add Divider button to the left of the existing Add button in the header (matching the systems layout: outline variant, `Minus` icon)
- In desktop grid: wrap each row's content in a conditional — if `item.is_divider`, render a `col-span-8` merged cell with centered bold `DebouncedInput` + delete button on blue background (`bg-blue-100`), else render normal row
- In mobile cards: same conditional — divider renders as a styled card with centered input + delete button
- Filter divider rows from required-field validation (dividers don't need equipment_type)

**3. `supabase/functions/generate-inspection-html/index.ts`** (2 places — combined and separate equipment pages)
- In both equipment `.map()` blocks, add divider check before normal row rendering:
```typescript
if (eq.is_divider) {
  return `<tr><td colspan="6" style="text-align:center; font-weight:bold; padding:10px; background:#dbeafe; font-size:11pt;">${eq.divider_text || ''}</td></tr>`;
}
```

**4. `supabase/functions/generate-inspection-pdf/index.ts`**
- In the `items.map()` block, add divider check matching systems pattern:
```typescript
if (eq.is_divider) {
  return [{ content: eq.divider_text || '', colSpan: 5, styles: { halign: 'center', fontStyle: 'bold', fillColor: [219, 234, 254] } }];
}
```

### Button Layout
The header buttons will use the same flex layout as Operating Systems:
```tsx
<div className="flex gap-2 w-full md:w-auto">
  <Button onClick={addDivider} size="sm" variant="outline" className="flex-1 md:flex-none shrink-0">
    <Minus className="w-4 h-4 mr-2" /> Divider
  </Button>
  <Button onClick={addEquipment} size="sm" className="flex-1 md:flex-none shrink-0">
    <Plus className="w-4 h-4 mr-2" /> Add {displayName}
  </Button>
</div>
```

### Files
| File | Change |
|------|--------|
| Database migration | Add `is_divider` + `divider_text` columns to `inspection_equipment` |
| `src/components/inspection/EquipmentTable.tsx` | Add divider button, divider row rendering (desktop + mobile), `addDivider` callback |
| `supabase/functions/generate-inspection-html/index.ts` | Render equipment dividers as merged colspan rows (2 locations) |
| `supabase/functions/generate-inspection-pdf/index.ts` | Render equipment dividers as merged colspan rows |

