-- Re-create all 18 triggers using DROP IF EXISTS to handle partial state
-- Previous migration partially applied (some triggers exist, some don't)

-- 1. UPDATED_AT TRIGGERS
DROP TRIGGER IF EXISTS set_updated_at_inspections ON public.inspections;
CREATE TRIGGER set_updated_at_inspections BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_trainings ON public.trainings;
CREATE TRIGGER set_updated_at_trainings BEFORE UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_daily_assessments ON public.daily_assessments;
CREATE TRIGGER set_updated_at_daily_assessments BEFORE UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. AUTO-LINK ORGANIZATION TRIGGERS
DROP TRIGGER IF EXISTS auto_link_org_inspections ON public.inspections;
CREATE TRIGGER auto_link_org_inspections BEFORE INSERT OR UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.auto_link_organization();

DROP TRIGGER IF EXISTS auto_link_org_trainings ON public.trainings;
CREATE TRIGGER auto_link_org_trainings BEFORE INSERT OR UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.auto_link_organization();

DROP TRIGGER IF EXISTS auto_link_org_daily_assessments ON public.daily_assessments;
CREATE TRIGGER auto_link_org_daily_assessments BEFORE INSERT OR UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.auto_link_organization();

-- 3. PREVENT INSPECTOR_ID CHANGE TRIGGERS
DROP TRIGGER IF EXISTS prevent_inspector_change_inspections ON public.inspections;
CREATE TRIGGER prevent_inspector_change_inspections BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

DROP TRIGGER IF EXISTS prevent_inspector_change_trainings ON public.trainings;
CREATE TRIGGER prevent_inspector_change_trainings BEFORE UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

DROP TRIGGER IF EXISTS prevent_inspector_change_daily_assessments ON public.daily_assessments;
CREATE TRIGGER prevent_inspector_change_daily_assessments BEFORE UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

-- 4. AUDIT TRIGGERS
DROP TRIGGER IF EXISTS audit_inspection_completion_trigger ON public.inspections;
CREATE TRIGGER audit_inspection_completion_trigger AFTER UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.audit_inspection_completion();

DROP TRIGGER IF EXISTS audit_user_role_changes_trigger ON public.user_roles;
CREATE TRIGGER audit_user_role_changes_trigger AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.audit_user_role_changes();

DROP TRIGGER IF EXISTS audit_notification_send_trigger ON public.notifications_log;
CREATE TRIGGER audit_notification_send_trigger AFTER INSERT ON public.notifications_log FOR EACH ROW EXECUTE FUNCTION public.audit_notification_send();

-- 5. PUSH NOTIFICATION TRIGGERS
DROP TRIGGER IF EXISTS notify_inspection_completed_push ON public.inspections;
CREATE TRIGGER notify_inspection_completed_push AFTER UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_inspection_completed();

DROP TRIGGER IF EXISTS notify_training_completed_push ON public.trainings;
CREATE TRIGGER notify_training_completed_push AFTER UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_training_completed();

DROP TRIGGER IF EXISTS notify_daily_assessment_completed_push ON public.daily_assessments;
CREATE TRIGGER notify_daily_assessment_completed_push AFTER UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_daily_assessment_completed();

-- 6. EMAIL NOTIFICATION TRIGGERS
DROP TRIGGER IF EXISTS notify_inspection_completed_email ON public.inspections;
CREATE TRIGGER notify_inspection_completed_email AFTER UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_inspection_email();

DROP TRIGGER IF EXISTS notify_training_completed_email ON public.trainings;
CREATE TRIGGER notify_training_completed_email AFTER UPDATE ON public.trainings FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_training_email();

DROP TRIGGER IF EXISTS notify_daily_assessment_completed_email ON public.daily_assessments;
CREATE TRIGGER notify_daily_assessment_completed_email AFTER UPDATE ON public.daily_assessments FOR EACH ROW EXECUTE FUNCTION public.notify_super_admins_daily_assessment_email();