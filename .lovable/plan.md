
# Plan: Add "Report Modified By" Indicator for Super Admin Edits (v2.3.3)

## Summary

When a Super Admin edits a completed report created by another user, a new field will appear below the "Inspector" field showing "Report modified by [Super Admin Name]". This provides accountability and transparency about who has made changes to finalized reports.

## Current State

- Inspector field shows the original report creator's name (fetched from `profiles` via `inspector_id`)
- No tracking of who last modified a report
- Super Admins can now edit all reports (as of v2.3.2)

## Implementation Approach

### Database Changes

Add a `last_modified_by` column to all three report tables to track who last made changes:

| Table | New Column | Type | Description |
|-------|-----------|------|-------------|
| `inspections` | `last_modified_by` | UUID (nullable) | References `profiles.id` |
| `trainings` | `last_modified_by` | UUID (nullable) | References `profiles.id` |
| `daily_assessments` | `last_modified_by` | UUID (nullable) | References `profiles.id` |

The column will:
- Be NULL for reports never modified by someone other than the owner
- Be set to the current user's ID when a Super Admin saves changes
- Only be set when `last_modified_by` differs from `inspector_id` (owner edits don't need tracking)

### Frontend Changes

**1. Update InspectionHeader Component**

Add a new prop `modifiedByProfile` and conditionally render the "Report modified by" field:

```text
+------------------------------------------+
|  Inspector                               |
|  [John Smith (disabled)]                 |
|                                          |
|  Report modified by                      | ← NEW (only shows if modified)
|  [Admin User (disabled)]                 |
+------------------------------------------+
```

**2. Update TrainingHeader Component**

Add "Report modified by" field below the "Trainer(s) of Record" section when applicable.

**3. Update DailyAssessmentHeader Component**

Add "Report modified by" field below the "Trainer/Facilitator of Record" field when applicable.

**4. Fetch Modified-By Profile in Form Pages**

Update InspectionForm, TrainingForm, and DailyAssessmentForm to:
- Fetch the `last_modified_by` profile when loading the report
- Pass it to the header component
- Update `last_modified_by` when saving (only if current user is not the owner)

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| Database | **Migration** | Add `last_modified_by` column to 3 tables |
| `src/components/inspection/InspectionHeader.tsx` | **Modify** | Add modified-by display field |
| `src/components/training/TrainingHeader.tsx` | **Modify** | Add modified-by display field |
| `src/components/daily-assessment/DailyAssessmentHeader.tsx` | **Modify** | Add modified-by display field |
| `src/pages/InspectionForm.tsx` | **Modify** | Fetch and pass modified-by profile, update on save |
| `src/pages/TrainingForm.tsx` | **Modify** | Fetch and pass modified-by profile, update on save |
| `src/pages/DailyAssessmentForm.tsx` | **Modify** | Fetch and pass modified-by profile, update on save |
| `vite.config.ts` | **Modify** | Version bump to 2.3.3 |

---

## Database Migration SQL

```sql
-- Add last_modified_by column to inspections
ALTER TABLE inspections 
ADD COLUMN last_modified_by UUID REFERENCES profiles(id);

-- Add last_modified_by column to trainings
ALTER TABLE trainings 
ADD COLUMN last_modified_by UUID REFERENCES profiles(id);

-- Add last_modified_by column to daily_assessments
ALTER TABLE daily_assessments 
ADD COLUMN last_modified_by UUID REFERENCES profiles(id);
```

---

## UI Behavior Logic

The "Report modified by" field will **only appear** when:
1. `last_modified_by` is NOT NULL, AND
2. `last_modified_by` differs from `inspector_id`

This means:
- Owner edits their own report → Field does NOT appear
- Super Admin edits another user's report → Field APPEARS with Super Admin's name
- Super Admin edits their own report → Field does NOT appear

---

## Save Logic (Pseudo-code)

```typescript
// When saving a report
const handleSave = async () => {
  const currentUserId = await getUserWithCache()?.id;
  const isOwner = currentUserId === report.inspector_id;
  
  const updateData = {
    ...reportChanges,
    updated_at: new Date().toISOString(),
    // Only set last_modified_by if editor is NOT the owner
    ...(isOwner ? {} : { last_modified_by: currentUserId })
  };
  
  await supabase.from('inspections').update(updateData).eq('id', reportId);
};
```

---

## Visual Design

The new field will use the same styling as the existing Inspector field:
- Label: "Report modified by" (text-sm text-muted-foreground)
- Input: Disabled VoiceInput with bg-muted/50 styling
- Positioned directly below the Inspector field

---

## Testing Checklist

1. Owner edits own report → "Report modified by" does NOT appear
2. Super Admin edits other's report → "Report modified by" appears with their name
3. Multiple Super Admin edits → Shows most recent modifier's name
4. Field is read-only and cannot be changed by users
5. Works correctly for all three report types (Inspection, Training, Daily Assessment)
