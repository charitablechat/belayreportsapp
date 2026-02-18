
-- Fix trainings: replace dumb trigger with smart one
DROP TRIGGER IF EXISTS handle_training_updated_at ON trainings;
CREATE TRIGGER update_trainings_updated_at
  BEFORE UPDATE ON trainings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Fix daily_assessments: drop existing (wrong function), recreate with smart one
DROP TRIGGER IF EXISTS update_daily_assessments_updated_at ON daily_assessments;
CREATE TRIGGER update_daily_assessments_updated_at
  BEFORE UPDATE ON daily_assessments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
