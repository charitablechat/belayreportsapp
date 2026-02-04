
# Plan: Unified Global Shared Autocomplete System

## Overview

This plan consolidates the autocomplete functionality into a single, globally-shared system. Currently, there are two separate components (`DatabaseAutocomplete` and `HistoryAutocomplete`) using two different database tables. We'll migrate to using only `global_field_history` for all autocomplete fields, ensuring cross-user sharing while maintaining strict field-type scoping.

## Current Architecture

| Component | Database Table | Sharing Scope |
|-----------|---------------|---------------|
| `DatabaseAutocomplete` | `user_field_history` | Per-user only |
| `HistoryAutocomplete` | `global_field_history` | All users |

## Target Architecture

| Component | Database Table | Sharing Scope |
|-----------|---------------|---------------|
| `GlobalAutocomplete` (unified) | `global_field_history` | All users |

## Technical Implementation

### Phase 1: Extend Global Field History Table

Add missing field types to support all current autocomplete fields:

```sql
-- Migrate existing user_field_history entries to global_field_history
-- for the field types currently using DatabaseAutocomplete:
-- inspector_name, onsite_contact, trainer_name, organization

INSERT INTO global_field_history (field_type, value, usage_count, last_used_at)
SELECT DISTINCT field_type, value, MAX(usage_count), MAX(last_used_at)
FROM user_field_history
WHERE field_type IN ('inspector_name', 'onsite_contact', 'trainer_name', 'organization')
GROUP BY field_type, value
ON CONFLICT (field_type, value) DO UPDATE SET
  usage_count = GREATEST(global_field_history.usage_count, EXCLUDED.usage_count),
  last_used_at = GREATEST(global_field_history.last_used_at, EXCLUDED.last_used_at);
```

### Phase 2: Create Unified GlobalAutocomplete Component

Create a single component that replaces both `DatabaseAutocomplete` and `HistoryAutocomplete`:

**File**: `src/components/GlobalAutocomplete.tsx`

Key features:
- Uses `global_field_history` table exclusively
- Strictly scoped by `field_type` parameter (composite key)
- Lazy-loads suggestions when popover opens (performance optimization)
- Fire-and-forget upserts to avoid blocking UI
- Supports edit/delete for super admins only
- Maintains localStorage as offline fallback

```text
┌────────────────────────────────────────────┐
│            GlobalAutocomplete              │
├────────────────────────────────────────────┤
│ Props:                                     │
│   - value: string                          │
│   - onChange: (value: string) => void      │
│   - fieldType: GlobalFieldType             │
│   - placeholder?: string                   │
│   - disabled?: boolean                     │
└────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────┐
│        global_field_history table          │
├────────────────────────────────────────────┤
│ id | field_type | value | usage_count      │
├────────────────────────────────────────────┤
│ Unique constraint: (field_type, value)     │
│ RLS: Authenticated users can read/write    │
└────────────────────────────────────────────┘
```

### Phase 3: Define Comprehensive Field Types

Create a TypeScript type covering all autocomplete fields:

```typescript
export type GlobalFieldType = 
  // Header fields (previously DatabaseAutocomplete)
  | "inspector_name"
  | "previous_inspector"
  | "onsite_contact"
  | "trainer_name"
  | "organization"
  // Equipment fields
  | "equipment_type"
  // Operating systems
  | "operating_system_element"
  | "system_type"
  // Ziplines
  | "zipline_name"
  | "braking_system"
  | "ead_system"
  | "cable_type";
```

### Phase 4: Update All Form Components

Replace component usage across the codebase:

| File | Change |
|------|--------|
| `InspectionHeader.tsx` | Replace `DatabaseAutocomplete` with `GlobalAutocomplete` |
| `DailyAssessmentHeader.tsx` | Replace `DatabaseAutocomplete` with `GlobalAutocomplete` |
| `EquipmentTable.tsx` | Replace `HistoryAutocomplete` with `GlobalAutocomplete` |
| `OperatingSystemsTable.tsx` | Replace `HistoryAutocomplete` with `GlobalAutocomplete` |
| `ZiplinesTable.tsx` | Replace `HistoryAutocomplete` with `GlobalAutocomplete` |

### Phase 5: Ensure Data Integrity

The strict scoping is guaranteed by:
1. **Database-level**: Unique constraint on `(field_type, value)` ensures no duplicates within a field type
2. **Query-level**: All queries filter by `field_type`:
   ```typescript
   .eq('field_type', fieldType)
   ```
3. **Component-level**: Each component instance receives a specific `fieldType` prop that cannot be changed

### Phase 6: Offline Support

Maintain localStorage as a fallback layer:
- On popover open: Merge localStorage + database results
- On value selection: Write to both localStorage and database
- If database write fails: Value remains in localStorage for next sync attempt

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/GlobalAutocomplete.tsx` | Create new unified component |
| `src/components/inspection/InspectionHeader.tsx` | Update imports and component usage |
| `src/components/inspection/EquipmentTable.tsx` | Update imports and component usage |
| `src/components/inspection/OperatingSystemsTable.tsx` | Update imports and component usage |
| `src/components/inspection/ZiplinesTable.tsx` | Update imports and component usage |
| `src/components/daily-assessment/DailyAssessmentHeader.tsx` | Update imports and component usage |
| `supabase/migrations/[timestamp]_migrate_to_global_autocomplete.sql` | Migrate data from user_field_history |
| `vite.config.ts` | Version bump to 2.2.82 |

## Database Migration

```sql
-- 1. Migrate unique entries from user_field_history to global_field_history
INSERT INTO global_field_history (field_type, value, usage_count, last_used_at)
SELECT 
  field_type, 
  value, 
  SUM(usage_count) as total_usage,
  MAX(last_used_at) as last_used
FROM user_field_history
WHERE field_type IN ('inspector_name', 'onsite_contact', 'trainer_name')
GROUP BY field_type, value
ON CONFLICT (field_type, value) DO UPDATE SET
  usage_count = global_field_history.usage_count + EXCLUDED.usage_count,
  last_used_at = GREATEST(global_field_history.last_used_at, EXCLUDED.last_used_at);

-- 2. Add index for common query pattern if not exists
CREATE INDEX IF NOT EXISTS idx_global_field_history_lookup 
ON global_field_history(field_type, value);
```

## RLS Policy Verification

The existing RLS policies on `global_field_history` are appropriate:
- ✅ SELECT: All authenticated users can read
- ✅ INSERT: All authenticated users can insert
- ✅ UPDATE: All authenticated users can update (for usage_count increments)
- ⚠️ DELETE: Consider adding super_admin-only delete policy

## Scoping Guarantee

**Example**: User enters "Singing Rock" in the `equipment_type` field

Database entry:
```json
{
  "field_type": "equipment_type",
  "value": "Singing Rock",
  "usage_count": 1
}
```

When querying for `operating_system_element`:
```sql
SELECT value FROM global_field_history
WHERE field_type = 'operating_system_element'
-- "Singing Rock" will NOT appear (different field_type)
```

## Testing Checklist

1. Create inspection → enter new equipment type → verify it appears for all users
2. Enter value in "Previous Inspector" field → verify it does NOT appear in "Equipment Type"
3. Verify offline: Go airplane mode → enter values → reconnect → verify sync
4. Verify cross-report: Value entered in Report A appears as suggestion in Report B
5. Verify mobile: Autocomplete works smoothly on iOS/Android

## Version Update

```typescript
const APP_VERSION = "2.2.82";
```
