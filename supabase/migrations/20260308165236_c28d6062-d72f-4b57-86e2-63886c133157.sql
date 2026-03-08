-- Re-create all 18 missing database triggers

DROP TRIGGER IF EXISTS update_inspections_updated_at ON public.inspections;
CREATE TRIGGER update_inspections_updated_at BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_trainings_updated_at ON public.trainings;
CREATE TRIGGER update_trainings_updated_at BEFORE UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_assessments_updated_at ON public.daily_assessments;
CREATE TRIGGER update_daily_assessments_updated_at BEFORE UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_auto_link_organization ON public.inspections;
CREATE TRIGGER trigger_auto_link_organization BEFORE INSERT OR UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.auto_link_organization();

DROP TRIGGER IF EXISTS prevent_inspector_id_change_inspections ON public.inspections;
CREATE TRIGGER prevent_inspector_id_change_inspections BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

DROP TRIGGER IF EXISTS prevent_inspector_id_change_trainings ON public.trainings;
CREATE TRIGGER prevent_inspector_id_change_trainings BEFORE UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

DROP TRIGGER IF EXISTS prevent_inspector_id_change_daily_assessments ON public.daily_assessments;
CREATE TRIGGER prevent_inspector_id_change_daily_assessments BEFORE UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

DROP TRIGGER IF EXISTS on_inspection_completed ON public.inspections;
CREATE TRIGGER on_inspection_completed AFTER UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_inspection_completed();

DROP TRIGGER IF EXISTS on_training_completed ON public.trainings;
CREATE TRIGGER on_training_completed AFTER UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_training_completed();

DROP TRIGGER IF EXISTS on_daily_assessment_completed ON public.daily_assessments;
CREATE TRIGGER on_daily_assessment_completed AFTER UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_daily_assessment_completed();

DROP TRIGGER IF EXISTS on_inspection_completed_email ON public.inspections;
CREATE TRIGGER on_inspection_completed_email AFTER UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_inspection_email();

DROP TRIGGER IF EXISTS on_training_completed_email ON public.trainings;
CREATE TRIGGER on_training_completed_email AFTER UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_training_email();

DROP TRIGGER IF EXISTS on_daily_assessment_completed_email ON public.daily_assessments;
CREATE TRIGGER on_daily_assessment_completed_email AFTER UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_daily_assessment_email();

DROP TRIGGER IF EXISTS trigger_sync_conflict ON public.sync_conflicts;
CREATE TRIGGER trigger_sync_conflict AFTER INSERT ON public.sync_conflicts FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_sync_conflict();

DROP TRIGGER IF EXISTS audit_inspection_completion_trigger ON public.inspections;
CREATE TRIGGER audit_inspection_completion_trigger AFTER UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.audit_inspection_completion();

DROP TRIGGER IF EXISTS audit_user_role_changes_trigger ON public.user_roles;
CREATE TRIGGER audit_user_role_changes_trigger AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.audit_user_role_changes();

DROP TRIGGER IF EXISTS audit_notification_send_trigger ON public.notifications_log;
CREATE TRIGGER audit_notification_send_trigger AFTER INSERT ON public.notifications_log FOR EACH ROW EXECUTE FUNCTION public.audit_notification_send();

DROP TRIGGER IF EXISTS add_name_to_history_trigger ON public.profiles;
CREATE TRIGGER add_name_to_history_trigger AFTER INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.add_name_to_field_history();

-- Trigger health check RPC (P2)
CREATE OR REPLACE FUNCTION public.check_trigger_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
  v_expected INTEGER := 18;
  v_triggers jsonb;
BEGIN
  SELECT COUNT(*), jsonb_agg(jsonb_build_object('name', trigger_name, 'table', event_object_table))
  INTO v_count, v_triggers
  FROM information_schema.triggers
  WHERE trigger_schema = 'public';
  RETURN jsonb_build_object(
    'healthy', v_count >= v_expected,
    'active_count', v_count,
    'expected_count', v_expected,
    'triggers', COALESCE(v_triggers, '[]'::jsonb)
  );
END;
$$;