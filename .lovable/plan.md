

## Add "Divider" Row to Operating Systems Table

### Database Migration
Add two columns to `inspection_systems` and relax constraints:
```sql
ALTER TABLE public.inspection_systems ADD COLUMN IF NOT EXISTS is_divider boolean NOT NULL DEFAULT false;
ALTER TABLE public.inspection_systems ADD COLUMN IF NOT EXISTS divider_text text;
ALTER TABLE public.inspection_systems ALTER COLUMN result DROP NOT NULL;
ALTER TABLE public.inspection_systems ALTER COLUMN system_name DROP NOT NULL;
```

### Files to Change

**1. `src/components/inspection/OperatingSystemsTable.tsx`**
- Add "Divider" button (outline style, `Minus` icon) to the left of "Add System"
- Add `addDivider` handler that prepends `{ is_divider: true, divider_text: "", result: null, system_name: null }`
- Conditional rendering in both desktop and mobile views:
  - **Divider row (desktop):** single cell spanning all columns with centered `<Input>` on `bg-blue-100` background, bold text
  - **Divider row (mobile):** simplified card with centered input and blue background
  - **Normal row:** unchanged

**2. `src/lib/validation-schemas.ts`**
- Add `is_divider` and `divider_text` to `systemSchema`
- Make `result` optional/nullable for divider rows

**3. `supabase/functions/generate-inspection-html/index.ts`**
In both `.map()` blocks (~line 1898 and ~line 2022), check `sys.is_divider`:
- **Divider:** `<tr><td colspan="4" style="text-align:center; font-weight:bold; padding:10px; background:#dbeafe;">${sys.divider_text || ''}</td></tr>`
- **Normal:** existing row rendering

**4. `supabase/functions/generate-inspection-pdf/index.ts`**
In `systems.map()` (~line 317), check `sys.is_divider`:
- **Divider:** return `[{ content: sys.divider_text || '', colSpan: 3, styles: { halign: 'center', fontStyle: 'bold', fillColor: [219, 234, 254] } }]`
- **Normal:** existing array

