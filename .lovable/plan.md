

# Allow Organization Deletion by Fixing Foreign Key Constraints

## Problem

Deleting an organization fails because `inspections`, `trainings`, and `daily_assessments` have foreign key constraints on `organization_id` that default to `NO ACTION` (restrict). The `user_roles` and `organization_members` tables already use `ON DELETE CASCADE`.

## Solution

A single database migration to drop and re-add the three FK constraints with `ON DELETE SET NULL`. This is preferred over `CASCADE` because deleting an organization should NOT delete all associated reports -- the reports should remain intact with their `organization_id` set to `NULL`.

### Database Migration

```sql
-- Inspections
ALTER TABLE inspections DROP CONSTRAINT inspections_organization_id_fkey;
ALTER TABLE inspections ADD CONSTRAINT inspections_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Trainings
ALTER TABLE trainings DROP CONSTRAINT trainings_organization_id_fkey;
ALTER TABLE trainings ADD CONSTRAINT trainings_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Daily Assessments
ALTER TABLE daily_assessments DROP CONSTRAINT daily_assessments_organization_id_fkey;
ALTER TABLE daily_assessments ADD CONSTRAINT daily_assessments_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
```

### Why SET NULL instead of CASCADE

- `CASCADE` would permanently delete all inspections, trainings, and daily assessments linked to the organization -- catastrophic data loss
- `SET NULL` preserves all reports; they simply become unlinked from the deleted organization
- Reports still retain the text `organization` field (the name string), so they remain identifiable

## Technical Details

- **Files changed**: None (database-only migration)
- The admin delete button already calls `supabase.from('organizations').delete()` -- no code changes needed
- The `sync_conflicts` table FK is already handled by the `merge_organizations` function

