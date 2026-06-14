
-- ============================================================
-- JCF (Job Completion Form) — Phase 1: schema, RLS, triggers
-- ============================================================

CREATE TABLE public.jcf_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  organization text NOT NULL DEFAULT '',
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  location text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  staff_names text,
  date_of_work date DEFAULT CURRENT_DATE,
  client_name text,
  contact_info text,
  address text,
  contract_number text,
  invoice_number text,
  job_status text DEFAULT 'ongoing',
  course_type_low boolean DEFAULT false,
  course_type_high boolean DEFAULT false,
  course_type_tower boolean DEFAULT false,
  course_type_zip boolean DEFAULT false,
  course_type_indoor boolean DEFAULT false,
  course_type_poletype boolean DEFAULT false,
  course_type_other boolean DEFAULT false,
  course_type_other_text text,
  fall_protection_cable_grab boolean DEFAULT false,
  fall_protection_harness boolean DEFAULT false,
  fall_protection_lift_basket boolean DEFAULT false,
  fall_protection_alt_access boolean DEFAULT false,
  fall_protection_other boolean DEFAULT false,
  fall_protection_other_text text,
  manual_present boolean,
  training_status text,
  emergency_number text DEFAULT '911',
  hospital_info text,
  num_inspectors integer,
  hours_to_complete numeric,
  contracted_work text,
  jcf_notes text,
  work_needed_to_complete text,
  additional_work_performed text,
  time_and_materials text,
  equipment_left_with_client text,
  additional_work_this_year text,
  work_needed_next_year text,
  items_to_monitor text,
  latitude numeric,
  longitude numeric,
  active_duration_seconds integer DEFAULT 0,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  retention_until timestamptz,
  report_version integer DEFAULT 0,
  latest_report_generated_at timestamptz,
  latest_report_html text,
  last_modified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_opened_at timestamptz,
  last_sync_source text,
  user_cleared_at timestamptz,
  client_idempotency_key text,
  field_timestamps jsonb NOT NULL DEFAULT '{}'::jsonb,
  attestation_signed_at timestamptz,
  attestation_signer_name text,
  attestation_signer_id uuid,
  attestation_ip text,
  attestation_user_agent text,
  attestation_text text,
  app_version_at_completion text,
  completion_locked boolean NOT NULL DEFAULT false
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jcf_reports TO authenticated;
GRANT ALL ON public.jcf_reports TO service_role;

ALTER TABLE public.jcf_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jcf reports"
  ON public.jcf_reports FOR SELECT TO authenticated
  USING (inspector_id = auth.uid() OR public.is_admin_or_above());

CREATE POLICY "Users can insert own jcf reports"
  ON public.jcf_reports FOR INSERT TO authenticated
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Users can update own jcf reports"
  ON public.jcf_reports FOR UPDATE TO authenticated
  USING ((inspector_id = auth.uid()) AND (deleted_at IS NULL))
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Admins can update any jcf report"
  ON public.jcf_reports FOR UPDATE TO authenticated
  USING (public.is_admin_or_above())
  WITH CHECK (public.is_admin_or_above());

CREATE POLICY "Users can delete own jcf reports"
  ON public.jcf_reports FOR DELETE TO authenticated
  USING (inspector_id = auth.uid());

CREATE POLICY "Admins can delete any jcf report"
  ON public.jcf_reports FOR DELETE TO authenticated
  USING (public.is_admin_or_above());

CREATE INDEX idx_jcf_reports_inspector ON public.jcf_reports(inspector_id);
CREATE INDEX idx_jcf_reports_organization_id ON public.jcf_reports(organization_id);
CREATE INDEX idx_jcf_reports_status ON public.jcf_reports(status);
CREATE INDEX idx_jcf_reports_deleted_at ON public.jcf_reports(deleted_at);
CREATE INDEX idx_jcf_reports_updated_at ON public.jcf_reports(updated_at);
CREATE UNIQUE INDEX idx_jcf_reports_client_idem
  ON public.jcf_reports(inspector_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

-- jcf_photos
CREATE TABLE public.jcf_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jcf_id uuid NOT NULL REFERENCES public.jcf_reports(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  caption text,
  photo_section text,
  display_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  retention_until timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jcf_photos TO authenticated;
GRANT ALL ON public.jcf_photos TO service_role;

ALTER TABLE public.jcf_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view photos of own jcf reports"
  ON public.jcf_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jcf_reports r WHERE r.id = jcf_photos.jcf_id AND (r.inspector_id = auth.uid() OR public.is_admin_or_above())));

CREATE POLICY "Users can insert photos for own jcf reports"
  ON public.jcf_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.jcf_reports r WHERE r.id = jcf_photos.jcf_id AND (r.inspector_id = auth.uid() OR public.is_admin_or_above())));

CREATE POLICY "Users can update photos of own jcf reports"
  ON public.jcf_photos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jcf_reports r WHERE r.id = jcf_photos.jcf_id AND (r.inspector_id = auth.uid() OR public.is_admin_or_above())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jcf_reports r WHERE r.id = jcf_photos.jcf_id AND (r.inspector_id = auth.uid() OR public.is_admin_or_above())));

CREATE POLICY "Users can delete photos of own jcf reports"
  ON public.jcf_photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jcf_reports r WHERE r.id = jcf_photos.jcf_id AND (r.inspector_id = auth.uid() OR public.is_admin_or_above())));

CREATE INDEX idx_jcf_photos_jcf_id ON public.jcf_photos(jcf_id);
CREATE INDEX idx_jcf_photos_section ON public.jcf_photos(photo_section);

-- Triggers on jcf_reports
CREATE TRIGGER jcf_reports_updated_at
  BEFORE UPDATE ON public.jcf_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER jcf_reports_auto_link_org
  BEFORE INSERT OR UPDATE ON public.jcf_reports
  FOR EACH ROW EXECUTE FUNCTION public.auto_link_organization();

CREATE TRIGGER jcf_reports_prevent_inspector_change
  BEFORE UPDATE ON public.jcf_reports
  FOR EACH ROW EXECUTE FUNCTION public.prevent_inspector_id_change();

CREATE TRIGGER trg_audit_jcf_reports
  AFTER INSERT OR UPDATE OR DELETE ON public.jcf_reports
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

-- jcf_photos triggers
CREATE TRIGGER trg_audit_jcf_photos
  AFTER INSERT OR UPDATE OR DELETE ON public.jcf_photos
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

CREATE TRIGGER protect_mass_delete_jcf_photos
  AFTER DELETE ON public.jcf_photos
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_child_row_mass_delete('jcf_id');

-- JCF notification functions
CREATE OR REPLACE FUNCTION public.notify_super_admins_jcf_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inspector_name TEXT;
  v_org_name TEXT;
  v_webhook_secret TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    SELECT name INTO v_org_name FROM organizations WHERE id = NEW.organization_id;
    SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), NEW.inspector_id::TEXT)
      INTO v_inspector_name FROM profiles WHERE id = NEW.inspector_id;
    v_inspector_name := COALESCE(v_inspector_name, NEW.inspector_id::TEXT);
    v_webhook_secret := internal_get_webhook_secret();
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_webhook_secret),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'jcf_completed',
        'title', 'JCF Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed a JCF at ' || COALESCE(NEW.location, 'unknown location'),
        'data', jsonb_build_object('jcfId', NEW.id, 'organization', v_org_name, 'location', NEW.location)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_super_admins_jcf_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inspector_name TEXT;
  v_org_name TEXT;
  v_webhook_secret TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    SELECT name INTO v_org_name FROM organizations WHERE id = NEW.organization_id;
    SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), NEW.inspector_id::TEXT)
      INTO v_inspector_name FROM profiles WHERE id = NEW.inspector_id;
    v_inspector_name := COALESCE(v_inspector_name, NEW.inspector_id::TEXT);
    v_webhook_secret := internal_get_webhook_secret();
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_webhook_secret),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'jcf_completed',
        'title', 'JCF Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed a JCF at ' || COALESCE(NEW.location, 'unknown location'),
        'data', jsonb_build_object('jcfId', NEW.id, 'organization', v_org_name, 'location', NEW.location, 'inspector', v_inspector_name)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_jcf_completed_make
  AFTER UPDATE ON public.jcf_reports
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed'))
  EXECUTE FUNCTION public.notify_super_admins_jcf_completed();

CREATE TRIGGER on_jcf_completed_email
  AFTER UPDATE ON public.jcf_reports
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed'))
  EXECUTE FUNCTION public.notify_super_admins_jcf_email();

-- Extend soft_delete_record whitelist
CREATE OR REPLACE FUNCTION public.soft_delete_record(p_table_name text, p_record_id uuid, p_deleted_by uuid, p_retention_days integer DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_is_admin boolean := public.is_admin_or_above();
  v_rows integer;
BEGIN
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments', 'jcf_reports') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  EXECUTE format('SELECT inspector_id FROM %I WHERE id = $1', p_table_name)
    INTO v_owner USING p_record_id;
  IF v_owner IS NULL THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Record not found or not owned by caller';
    END IF;
  ELSIF v_owner <> v_caller AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied: only the owner or an admin can delete this record';
  END IF;
  IF NOT v_is_admin THEN
    p_deleted_by := v_caller;
  ELSIF p_deleted_by IS NULL THEN
    p_deleted_by := v_caller;
  END IF;
  EXECUTE format(
    'UPDATE %I SET deleted_at = NOW(), deleted_by = $1, retention_until = NOW() + ($2 || '' days'')::interval WHERE id = $3 AND deleted_at IS NULL',
    p_table_name
  ) USING p_deleted_by, p_retention_days::text, p_record_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- Replace cleanup function (must DROP first because return type changes)
DROP FUNCTION IF EXISTS public.cleanup_expired_deleted_records();

CREATE FUNCTION public.cleanup_expired_deleted_records()
RETURNS TABLE(inspections_deleted integer, trainings_deleted integer, daily_assessments_deleted integer, jcf_reports_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inspections_count INTEGER;
  v_trainings_count INTEGER;
  v_assessments_count INTEGER;
  v_jcf_count INTEGER;
BEGIN
  DELETE FROM public.inspections
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();
  GET DIAGNOSTICS v_inspections_count = ROW_COUNT;

  DELETE FROM public.trainings
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();
  GET DIAGNOSTICS v_trainings_count = ROW_COUNT;

  DELETE FROM public.daily_assessments
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();
  GET DIAGNOSTICS v_assessments_count = ROW_COUNT;

  DELETE FROM public.jcf_reports
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();
  GET DIAGNOSTICS v_jcf_count = ROW_COUNT;

  DELETE FROM public.inspection_photos
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();

  DELETE FROM public.training_photos
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();

  DELETE FROM public.daily_assessment_photos
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();

  DELETE FROM public.jcf_photos
  WHERE deleted_at IS NOT NULL AND retention_until IS NOT NULL AND retention_until < NOW();

  RETURN QUERY SELECT v_inspections_count, v_trainings_count, v_assessments_count, v_jcf_count;
END;
$function$;
