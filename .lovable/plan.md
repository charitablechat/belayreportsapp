

## Fix: Imported Equipment Not Showing in Form

### Root Cause

The AI extraction returns free-text equipment categories like `"Hardware"`, `"PPE"`, `"General"`, while the EquipmentTable component filters by hardcoded category slugs: `harnesses`, `helmets`, `lanyards`, `connectors`, `rope`, `belay`, `trolleys`, `other`.

The 18 equipment items ARE in the database and loaded into React state, but every EquipmentTable instance filters them out because `item.equipment_category === "harnesses"` never matches `"Hardware"`.

### Fix

**File: `src/pages/NewInspection.tsx`** — Add a category normalization function in `insertChildData` that maps AI-returned categories to the app's expected slug values before inserting.

```text
Mapping logic:
  - Contains "harness" → "harnesses"
  - Contains "helmet" or "head" → "helmets"
  - Contains "lanyard" or "sling" → "lanyards"
  - Contains "carabiner" or "connector" or "quicklink" or "hardware" → "connectors"
  - Contains "rope" → "rope"
  - Contains "belay" or "descent" → "belay"
  - Contains "trolley" or "pulley" → "trolleys"
  - Everything else → "other"
```

Also update the AI tool schema in **`supabase/functions/parse-inspection-docx/index.ts`** to hint the expected categories in the `equipment_category` description, so the AI returns closer matches:

```
equipment_category: {
  type: "string",
  description: "Category slug: harnesses, helmets, lanyards, connectors, rope, belay, trolleys, or other"
}
```

### Files

| File | Change |
|------|--------|
| `src/pages/NewInspection.tsx` | Add `normalizeEquipmentCategory()` function; apply it in `insertChildData` when mapping equipment rows |
| `supabase/functions/parse-inspection-docx/index.ts` | Update `equipment_category` description in tool schema to list valid slugs |

