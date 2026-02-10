

# Scope Organization & Facility Dropdowns to Per-User; Keep All Others Global

## Current State

| Component | Table Used | Scoping |
|-----------|-----------|---------|
| `GlobalAutocomplete` (all field types) | `global_field_history` | Shared across all users (no `user_id` column) |
| `OrganizationAutocomplete` | `global_field_history` + `organizations` | Shared across all users |

The `user_field_history` table already exists with a `user_id` column and user-scoped RLS policies (`auth.uid() = user_id`), but is currently unused (legacy). It already has 26 organization entries from a previous migration.

## What Changes

### 1. Switch `OrganizationAutocomplete` to `user_field_history` (user-scoped)

Currently it reads/writes `global_field_history` with `field_type = "organization"`. Change it to read/write `user_field_history` instead, passing `auth.uid()` as `user_id`. This makes saved organization entries visible **only to the user who entered them**.

The component will still also query the shared `organizations` table as a secondary "global suggestions" source (existing behavior), so users can pick from known organizations -- but their personal history stays private.

**Offline integration:** The existing `localStorage` fallback key (`global-autocomplete-organization`) will be renamed to `user-autocomplete-organization` to keep offline cache scoped. On reconnect, the sync writes to `user_field_history` with the real `user_id` (resolved via `getOfflineUserId()` fallback).

### 2. Remove `"organization"` from `GlobalFieldType`

Since organizations are no longer stored in the global table, remove `"organization"` from the `GlobalFieldType` union in `GlobalAutocomplete.tsx` to prevent accidental global writes.

### 3. Add `"facility"` field type to `user_field_history` (user-scoped)

"Facility" currently uses `OrganizationAutocomplete` in InspectionHeader (labeled "Facility Name"). Since it shares the same component, it will automatically become user-scoped with change 1.

### 4. No changes to other dropdowns

All other `GlobalAutocomplete` field types (`inspector_name`, `previous_inspector`, `onsite_contact`, `trainer_name`, `equipment_type`, `operating_system_element`, `system_type`, `zipline_name`, `braking_system`, `ead_system`, `cable_type`) remain on `global_field_history` -- shared across all users as required.

## Technical Details

### Database

No schema changes needed. Both tables already exist with correct structures:
- `global_field_history`: `(id, field_type, value, usage_count, last_used_at)` with UNIQUE on `(field_type, value)` -- no `user_id`
- `user_field_history`: `(id, user_id, field_type, value, usage_count, last_used_at)` with RLS `auth.uid() = user_id`

The existing RLS on `user_field_history` already enforces user-scoping for all operations.

### Files Modified

| File | Change |
|------|--------|
| `src/components/OrganizationAutocomplete.tsx` | Switch from `global_field_history` to `user_field_history` for save/read/update/delete mutations. Pass current user ID on inserts. Keep `organizations` table as secondary global source. |
| `src/components/GlobalAutocomplete.tsx` | Remove `"organization"` from the `GlobalFieldType` union type (line 31). No other changes. |

### Offline Behavior

- **User-scoped data (Org/Facility):** Saved to `localStorage` under `user-autocomplete-organization`. On reconnect, upserted to `user_field_history` with the real user ID.
- **Global data (all other fields):** No change -- continues to use `global_field_history` with `localStorage` fallback keyed by `global-autocomplete-{fieldType}`.
- Both paths integrate with the existing offline auth via `getOfflineUserId()` for identity resolution when offline.
