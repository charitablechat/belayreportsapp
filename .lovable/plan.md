

# Plan: Enable Super Admin Edit Access for All Reports (v2.3.2)

## Summary

This plan enables Super Admins to edit all reports (Inspections, Trainings, Daily Assessments), not just view them. Currently, Super Admins have view-only access when viewing reports created by other users. This change will allow full edit capabilities while maintaining data accountability through audit logging.

## Current State Analysis

### Frontend (UI Layer)
The `useReportEditPermission` hook currently returns `canEdit: false` for Super Admins viewing other users' reports:

```typescript
// Current behavior (lines 122-131)
if (isSuperAdmin) {
  return {
    canEdit: false,        // ← Blocks editing
    isReadOnly: true,      // ← Disables all inputs
    readOnlyReason: 'Super Admins have view-only access...'
  };
}
```

### Backend (Database Layer)
Super Admin UPDATE policies **already exist** for all main tables:
- `inspections` - "Super admins can update all inspections"
- `trainings` - "Super admins can update all trainings"  
- `daily_assessments` - "Super admins can update all daily assessments"
- All training child tables have `ALL` policies for Super Admins

**Missing policies** for inspection child tables:
- `inspection_systems`
- `inspection_ziplines`
- `inspection_equipment`
- `inspection_standards`
- `inspection_summary`
- `inspection_photos`

**Missing policies** for daily assessment child tables:
- `daily_assessment_beginning_of_day`
- `daily_assessment_end_of_day`
- `daily_assessment_environment_checks`
- `daily_assessment_equipment_checks`
- `daily_assessment_operating_systems`
- `daily_assessment_structure_checks`

---

## Implementation Plan

### Step 1: Update Permission Hook

**File:** `src/hooks/useReportEditPermission.tsx`

**Change:** Modify the Super Admin case to return `canEdit: true` and `isReadOnly: false`

```typescript
// AFTER - Super Admin viewing someone else's report - full edit access
if (isSuperAdmin) {
  return {
    canEdit: true,         // ← Enable editing
    isReadOnly: false,     // ← Enable all inputs
    isOwner: false,
    isSuperAdmin: true,
    isLoading: false,
    readOnlyReason: null   // ← No restriction message
  };
}
```

**Documentation Update:** Update the JSDoc comment to reflect the new policy

---

### Step 2: Add Missing Database RLS Policies

**Tables Requiring UPDATE Policies for Super Admins:**

| Table | Policy Name |
|-------|-------------|
| `inspection_systems` | Super admins can update all inspection systems |
| `inspection_ziplines` | Super admins can update all inspection ziplines |
| `inspection_equipment` | Super admins can update all inspection equipment |
| `inspection_standards` | Super admins can update all inspection standards |
| `inspection_summary` | Super admins can update all inspection summaries |
| `inspection_photos` | Super admins can update all inspection photos |
| `daily_assessment_beginning_of_day` | Super admins can update all beginning of day checks |
| `daily_assessment_end_of_day` | Super admins can update all end of day checks |
| `daily_assessment_environment_checks` | Super admins can update all environment checks |
| `daily_assessment_equipment_checks` | Super admins can update all equipment checks |
| `daily_assessment_operating_systems` | Super admins can update all operating systems |
| `daily_assessment_structure_checks` | Super admins can update all structure checks |

**SQL Migration:**

```sql
-- Super Admin UPDATE policies for inspection child tables
CREATE POLICY "Super admins can update all inspection systems"
  ON inspection_systems FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all inspection ziplines"
  ON inspection_ziplines FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- (Similar for all other tables...)
```

---

### Step 3: Version Bump

**File:** `vite.config.ts`

Update version to **v2.3.2** with changelog comment.

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useReportEditPermission.tsx` | **Modify** | Change Super Admin logic to allow editing |
| `vite.config.ts` | **Modify** | Version bump to 2.3.2 |
| Database | **Migration** | Add 12 UPDATE policies for child tables |

---

## Security Considerations

1. **Audit Trail**: The `inspector_id` field remains immutable via database trigger (`prevent_inspector_id_change`), preserving original authorship
2. **Accountability**: `updated_at` timestamps will show when Super Admins modify records
3. **No Ownership Transfer**: Super Admins can edit content but cannot change who "owns" the report

---

## Testing Checklist

1. **Super Admin Editing Own Report** - Should work (unchanged)
2. **Super Admin Editing Another User's Report** - Should now work (previously blocked)
3. **Regular User Editing Own Report** - Should work (unchanged)
4. **Regular User Editing Another User's Report** - Should be blocked by RLS (unchanged)
5. **Inspector ID Immutability** - Verify the trigger still prevents ownership changes
6. **All Form Inputs** - Verify date pickers, text fields, selects, and photo uploads are enabled

