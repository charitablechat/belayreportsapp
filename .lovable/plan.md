

## Fix: Standards Checkboxes Unresponsive for Unsaved Rows

### Root Cause

When standards data loads from the database (line 1207) or offline storage (line 992), `setStandards(standardsData)` replaces the initial 6-item array with only the records that were previously saved (e.g., 3 items if only 3 were checked). 

In `StandardsTable.updateStandard` (line 29), the code does:
```typescript
updated[index] = { 
  ...updated[index],        // undefined if index >= array length
  id: updated[index].id || crypto.randomUUID(),  // TypeError!
```

For indices beyond the loaded array length, `updated[index]` is `undefined`, causing a silent `TypeError` that prevents the checkbox from toggling.

### Fix (2 changes)

#### 1. `src/components/inspection/StandardsTable.tsx` — Defensive access in `updateStandard`

Replace lines 25-33 to handle missing array entries:
```typescript
const updated = [...standards];
const inspectionId = window.location.pathname.split('/').pop();
const existing = updated[index] || {};
updated[index] = { 
  ...existing, 
  id: existing.id || crypto.randomUUID(),
  inspection_id: inspectionId,
  standard_name: STANDARDS_LIST[index].name,
  has_documentation 
};
```

#### 2. `src/pages/InspectionForm.tsx` — Pad loaded standards to always have 6 entries

When loading from DB (line 1205-1210) and offline storage (lines 990-993, 1291), merge loaded data into the full 6-item template so unset standards keep their placeholder entries:

```typescript
// Helper: merge loaded standards into full 6-item template
const mergeStandards = (loaded: any[]) => {
  return STANDARDS_TEMPLATE.map(template => {
    const match = loaded.find(s => s.standard_name === template.standard_name);
    return match || { ...template, id: crypto.randomUUID() };
  });
};
```

Add `STANDARDS_TEMPLATE` constant (matching `STANDARDS_LIST` from StandardsTable) near the top of InspectionForm, and apply `mergeStandards()` at all 3 `setStandards` call sites that load from external sources.

### Result
- All 6 standard rows always exist in the array, even if only some were saved
- Clicking any YES/NO checkbox works reliably on desktop, iOS, and Android
- Previously saved selections are preserved through the merge

### Files Modified
- `src/components/inspection/StandardsTable.tsx` (defensive access)
- `src/pages/InspectionForm.tsx` (pad loaded standards array)

