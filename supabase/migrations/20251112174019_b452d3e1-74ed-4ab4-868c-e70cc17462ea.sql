-- Create trigger for inspection completion notifications
CREATE OR REPLACE TRIGGER trigger_notify_inspection_completed
  AFTER UPDATE ON public.inspections
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed'))
  EXECUTE FUNCTION public.notify_super_admins_inspection_completed();

-- Create trigger for sync conflict notifications
CREATE OR REPLACE TRIGGER trigger_notify_sync_conflict
  AFTER INSERT ON public.sync_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_sync_conflict();