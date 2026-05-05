
-- STEP 2A: One-shot prune of audit_logs
UPDATE public.audit_logs
SET old_values = NULL, new_values = NULL
WHERE action_type LIKE '%.update'
  AND created_at < NOW() - INTERVAL '14 days'
  AND (old_values IS NOT NULL OR new_values IS NOT NULL);

DELETE FROM public.audit_logs
WHERE action_type = 'client.error'
  AND created_at < NOW() - INTERVAL '30 days';

DELETE FROM public.audit_logs
WHERE action_type LIKE '%.update'
  AND created_at < NOW() - INTERVAL '90 days';

-- STEP 2B: Replace fn_audit_table_change to strip heavy fields
CREATE OR REPLACE FUNCTION public.fn_audit_table_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_record_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_strip_keys text[] := ARRAY[
    'latest_report_html','latest_report_pdf','report_html','cached_html',
    'summary','narrative','generated_summary','generated_narrative',
    'environment_comments','structure_comments','systems_comments',
    'field_timestamps'
  ];
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := TG_TABLE_NAME || '.insert';
    v_old := NULL;
    v_new := to_jsonb(NEW);
    BEGIN v_record_id := (NEW).id; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    IF v_old = v_new THEN
      RETURN NEW;
    END IF;
    IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
      v_action := TG_TABLE_NAME || '.soft_delete';
    ELSIF (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
      v_action := TG_TABLE_NAME || '.restore';
    ELSIF (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed') THEN
      v_action := TG_TABLE_NAME || '.complete';
    ELSIF (OLD.inspector_id IS DISTINCT FROM NEW.inspector_id) THEN
      v_action := TG_TABLE_NAME || '.reassign';
    ELSE
      v_action := TG_TABLE_NAME || '.update';
    END IF;
    BEGIN v_record_id := (NEW).id; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := TG_TABLE_NAME || '.hard_delete';
    v_old := to_jsonb(OLD);
    v_new := NULL;
    BEGIN v_record_id := (OLD).id; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  END IF;

  IF v_old IS NOT NULL THEN
    FOREACH k IN ARRAY v_strip_keys LOOP
      v_old := v_old - k;
    END LOOP;
  END IF;
  IF v_new IS NOT NULL THEN
    FOREACH k IN ARRAY v_strip_keys LOOP
      v_new := v_new - k;
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action_type, table_name, record_id,
    old_values, new_values, metadata
  ) VALUES (
    auth.uid(), v_action, TG_TABLE_NAME, v_record_id,
    v_old, v_new,
    jsonb_build_object('op', TG_OP, 'schema', TG_TABLE_SCHEMA)
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- STEP 2C: Scheduled cleanup
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.run_retention_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_audit_trimmed int := 0;
  v_audit_deleted_errors int := 0;
  v_audit_deleted_old int := 0;
  v_backups_deleted int := 0;
BEGIN
  UPDATE public.audit_logs
  SET old_values = NULL, new_values = NULL
  WHERE action_type LIKE '%.update'
    AND created_at < NOW() - INTERVAL '14 days'
    AND (old_values IS NOT NULL OR new_values IS NOT NULL);
  GET DIAGNOSTICS v_audit_trimmed = ROW_COUNT;

  DELETE FROM public.audit_logs
  WHERE action_type = 'client.error'
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_audit_deleted_errors = ROW_COUNT;

  DELETE FROM public.audit_logs
  WHERE action_type LIKE '%.update'
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_audit_deleted_old = ROW_COUNT;

  DELETE FROM storage.objects
  WHERE bucket_id = 'database-backups'
    AND name LIKE 'daily/%'
    AND created_at < NOW() - INTERVAL '14 days';
  GET DIAGNOSTICS v_backups_deleted = ROW_COUNT;

  DELETE FROM public.backup_history
  WHERE created_at < NOW() - INTERVAL '14 days'
    AND file_path LIKE 'daily/%';

  RETURN jsonb_build_object(
    'audit_trimmed', v_audit_trimmed,
    'audit_deleted_client_errors', v_audit_deleted_errors,
    'audit_deleted_old_updates', v_audit_deleted_old,
    'backup_files_deleted', v_backups_deleted,
    'ran_at', NOW()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.run_retention_cleanup() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('nightly-retention-cleanup');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'nightly-retention-cleanup',
  '30 3 * * *',
  $$ SELECT public.run_retention_cleanup(); $$
);
