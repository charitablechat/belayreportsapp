

# Category-Specific Equipment Type Dropdowns with Auto-Growing Lists

## Overview
Replace the current flat `equipment_type` GlobalAutocomplete with category-scoped dropdown lists (e.g., harnesses only show harness types). Custom entries automatically become permanent options. Everything works offline.

## Database

### New table: `equipment_type_options`
| Column | Type | Default |
|--------|------|---------|
| id | uuid | gen_random_uuid() |
| equipment_category | text NOT NULL | |
| label | text NOT NULL | |
| display_order | int | 0 |
| is_active | boolean | true |
| created_by | uuid (nullable) | |
| created_at | timestamptz | now() |

Unique constraint on `(equipment_category, LOWER(label))` to prevent duplicates.

RLS: All authenticated users can SELECT and INSERT. Only admins (via `has_role`) can UPDATE/DELETE.

### Seed migration
One-time SQL that extracts `DISTINCT TRIM(equipment_type)` from `inspection_equipment` grouped by `equipment_category`, deduplicates by `LOWER()`, picks the most common casing as the canonical label, and inserts into `equipment_type_options`. Normalizes stale categories like `"Belay Device"` → `"belay"`, `"Bags"` → `"other"`.

## Offline Storage

### New IndexedDB object store: `equipment_type_cache`
- Added in a version bump (v10) in `offline-storage.ts`
- KeyPath: `id` (compound `${category}::${label}`)
- Index: `by-category`
- Helper functions: `getEquipmentTypeOptions(category)`, `putEquipmentTypeOption(entry)`, `bulkPutEquipmentTypeOptions(entries)`

This cache is populated on first fetch and refreshed on each sync cycle, ensuring full offline availability.

## New Hook: `src/hooks/useEquipmentTypeOptions.ts`

- Accepts `category: string`
- On mount: reads from IndexedDB cache first (instant offline), then fetches from Supabase and merges
- React Query with 5-minute stale time
- Exposes `options: string[]` and `addOption(label: string)` mutation
- `addOption`: inserts into both Supabase table AND IndexedDB immediately (optimistic), so the new entry appears in the dropdown instantly and persists offline
- If offline, writes to IndexedDB only; a flag marks it unsynced for later push

## Frontend Changes

### `EquipmentTable.tsx`
- Add new prop: `categoryOptions: string[]` and `onAddCategoryOption: (label: string) => void`
- Replace the `GlobalAutocomplete` for `equipment_type` with a combobox (Popover + Command pattern, matching the existing `DatabaseAutocomplete` style):
  - Shows category-specific options as a searchable dropdown
  - Allows free-text entry — if the typed value doesn't match an existing option, a "Create [value]" item appears
  - On selecting "Create", calls `onAddCategoryOption(value)` which adds it to the persistent list immediately
  - The existing `typeOptions` prop for Rope is replaced by the database-driven list
- Mobile card view gets the same combobox treatment

### `InspectionForm.tsx`
- Call `useEquipmentTypeOptions` for each category (harnesses, helmets, lanyards, connectors, rope, belay, trolleys, other)
- Pass `categoryOptions` and `onAddCategoryOption` to each `EquipmentTable`
- Remove the hardcoded `typeOptions` for Rope

### Admin UI (Super Admin Dashboard)
- New "Equipment Types" tab/section
- Table per category showing options with: edit label, toggle active/inactive, drag-to-reorder, add new, delete
- Follows existing `FormCMSManager` pattern

## Behavior Summary

```text
User types "Petzl GriGri" in Belay section:
  → Dropdown shows existing matches (if any)
  → If no match: "Create Petzl GriGri" option appears
  → User selects it → saved to DB + IndexedDB immediately
  → Next time any user opens Belay section, "Petzl GriGri" is in the dropdown
  → Works offline via IndexedDB cache

Admin manages lists:
  → Can rename, reorder, deactivate, or delete options
  → Deactivated options stop appearing but don't affect existing reports
```

## Files Changed
- **Migration**: 1 SQL file (create table + seed from historical data)
- **New**: `src/hooks/useEquipmentTypeOptions.ts`
- **Modified**: `src/lib/offline-storage.ts` (v10 upgrade + helpers), `EquipmentTable.tsx`, `InspectionForm.tsx`, `SuperAdminDashboard.tsx`

