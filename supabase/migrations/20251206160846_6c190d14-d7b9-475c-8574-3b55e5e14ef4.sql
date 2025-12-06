-- Backfill synced_at for existing records that are in the database (they are synced)
UPDATE trainings 
SET synced_at = COALESCE(updated_at, created_at)
WHERE synced_at IS NULL;

UPDATE daily_assessments 
SET synced_at = COALESCE(updated_at, created_at)
WHERE synced_at IS NULL;