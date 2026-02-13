
-- Inspections
ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_organization_id_fkey;
ALTER TABLE inspections ADD CONSTRAINT inspections_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Trainings
ALTER TABLE trainings DROP CONSTRAINT IF EXISTS trainings_organization_id_fkey;
ALTER TABLE trainings ADD CONSTRAINT trainings_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- Daily Assessments
ALTER TABLE daily_assessments DROP CONSTRAINT IF EXISTS daily_assessments_organization_id_fkey;
ALTER TABLE daily_assessments ADD CONSTRAINT daily_assessments_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
