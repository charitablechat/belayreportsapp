

# Upgrade Operating Systems Dropdown + Persistent Auto-Populate

## What
Apply the same enhancements from Equipment Type dropdowns to Operating Systems, with **strict data isolation** — operating system element names and system types are stored/queried under their own scoped keys, never mixing with equipment data.

## Data Isolation (Key Clarification)
- **System Type dropdown**: New hook queries `equipment_type_options` table with `equipment_category = "operating_systems"` — completely separate from equipment categories like `harnesses`, `helmets`, etc.
- **Element Name autocomplete**: Already uses `fieldType="operating_system_element"` in `GlobalAutocomplete`, which is a distinct scope from `equipment_type`. No change needed here for scoping.
- **`existingValues`** passed to each component come only from the current report's `systems` array — never from equipment items.

## Files

### 1. `src/hooks/useSystemTypeOptions.ts` — NEW
Mirror `useEquipmentTypeOptions` but hardcoded to category `"operating_systems"`:
- Seeds default options ("Top Rope", "Tensioned Rope", etc.) on first load
- Accepts `existingValues: string[]` from current report's `system_name` values
- Merges existing values so they always appear in dropdown
- Exposes `options`, `addOption`, `deleteOption`
- IndexedDB cache for offline

### 2. `src/components/SystemTypeSelect.tsx` — REWRITE
Replace `<Select>` with `Popover + Command` combobox (matching `EquipmentTypeCombobox`):
- Searchable, clears search on focus so all options show
- Alternating rows: `bg-blue-100` / `bg-gray-50`
- Text wrapping: `whitespace-normal break-words`
- Inline delete with confirmation for custom entries
- "Create new" option for unmatched input
- Props: `options`, `onAddOption`, `onDeleteOption` (from hook)

### 3. `src/components/inspection/OperatingSystemsTable.tsx` — UPDATE
- Import and call `useSystemTypeOptions("operating_systems", existingSystemNames)` where `existingSystemNames` = unique `system_name` values from `systems` array only
- Pass hook outputs to each `SystemTypeSelect`
- Collect unique `name` values from `systems` array, pass as `existingValues` to `GlobalAutocomplete` for element names

### 4. `src/components/GlobalAutocomplete.tsx` — UPDATE
- Add optional `existingValues?: string[]` prop
- After loading suggestions, merge any `existingValues` not already present (case-insensitive dedup)
- This ensures element names typed in the current report always appear as suggestions

### No database changes needed
Reuses existing `equipment_type_options` table with a new category value `"operating_systems"`.

