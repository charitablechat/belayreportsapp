-- Enable pg_net extension for async HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_inspection_completed ON public.inspections;
DROP TRIGGER IF EXISTS trigger_sync_conflict ON public.sync_conflicts;

-- Create trigger for inspection completed notifications
CREATE TRIGGER trigger_inspection_completed
  AFTER INSERT OR UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION notify_super_admins_inspection_completed();

-- Create trigger for sync conflict notifications
CREATE TRIGGER trigger_sync_conflict
  AFTER INSERT ON public.sync_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION notify_super_admins_sync_conflict();