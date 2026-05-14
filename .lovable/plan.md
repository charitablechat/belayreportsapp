## Plan

Mirror the `useSystemTypeOptions` pattern for the Element Name field so new accounts see seeded suggestions in the existing `GlobalAutocomplete` dropdown. No changes to `GlobalAutocomplete`, no new shadcn components, no styling/placeholder changes.

### Files

1. **`src/hooks/useElementNameOptions.ts`** (new) — direct copy of `useSystemTypeOptions.ts` with:
   - `CATEGORY = "operating_system_elements"`
   - `DEFAULT_ELEMENT_NAMES = ["Tower", "Two Line Bridge", "Base Station", "Signal Repeater", "Power Module"]`
   - Hook renamed `useElementNameOptions`
   - Reuses the existing `equipment_type_options` table + `getEquipmentTypeOptions` / `bulkPutEquipmentTypeOptions` / `putEquipmentTypeOption` IDB helpers (same offline behavior as the sibling). React-Query cache key `["equipment-type-options", "operating_system_elements"]` keeps it isolated from the Operating System list.
   - Same exported shape `{ options, isLoading, addOption }`.

2. **`src/components/inspection/OperatingSystemsTable.tsx`**
   - Import and call `useElementNameOptions(existingElementNames)`.
   - Pass returned `options` as `existingValues` on the Element Name `<GlobalAutocomplete>` (desktop ~line 234 and the mobile mirror).
   - Revert/remove the inline `DEFAULT_ELEMENT_NAMES` seed added in the previous turn — the hook is now the source of truth.
   - No other props change. `fieldType="operating_system_element"`, placeholder `"Enter or select name"`, and `className` stay as-is.

3. **`src/hooks/__tests__/useElementNameOptions.test.tsx`** (new)
   - There is no existing test for `useSystemTypeOptions`, so this is a fresh minimal spec following the project's vitest + `@testing-library/react` `renderHook` conventions.
   - Mocks `@/integrations/supabase/client`, `@/lib/offline-storage`, `@/lib/cached-auth`, `@/hooks/useNetworkStatus`.
   - Cases:
     1. Returns `DEFAULT_ELEMENT_NAMES` when offline and IDB cache is empty.
     2. Returns IDB cache labels when offline with cached entries.
     3. When online and DB returns rows, returns those labels and writes them to IDB via `bulkPutEquipmentTypeOptions`.
     4. When online and DB returns no rows, seeds defaults via `supabase.from("equipment_type_options").insert(...)` and returns `DEFAULT_ELEMENT_NAMES`.
     5. `addOption("Custom")` writes to IDB and inserts to Supabase, dedupes case-insensitively.
     6. `mergeExisting` behavior: in-progress `existingValues` not already in `options` are appended (case-insensitive dedupe).
   - Wraps the hook in a fresh `QueryClientProvider` per test.

### Out of scope

- No DB migration. `equipment_type_options` already accepts arbitrary `equipment_category` values; the new `"operating_system_elements"` category is created on first seed insert. (Confirm by inspection in implementation step; if a CHECK constraint blocks it, fall back to a migration.)
- No edits to `GlobalAutocomplete`, `SystemTypeSelect`, or any other report's Element Name field.
- No final-list curation — the five defaults are the placeholder list per the task; Belay can edit them later through the same `equipment_type_options` mechanism.
