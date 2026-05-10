-- Refactor run_retention_cleanup so one failure doesn't abort the rest,
-- remove the broken direct storage.objects DELETE (must use Storage API),
-- and add cron.job_run_details + admin_edit_snapshots pruning.
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
  v_admin_snapshots_deleted int := 0;
  v_cron_runs_deleted int := 0;
  v_backup_history_deleted int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  -- 1. Trim large jsonb columns from old audit log updates
  BEGIN
    UPDATE public.audit_logs
    SET old_values = NULL, new_values = NULL
    WHERE action_type LIKE '%.update'
      AND created_at < NOW() - INTERVAL '3 days'
      AND (old_values IS NOT NULL OR new_values IS NOT NULL);
    GET DIAGNOSTICS v_audit_trimmed = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('audit_trim', SQLERRM);
  END;

  -- 2. Delete old client errors (>30d)
  BEGIN
    DELETE FROM public.audit_logs
    WHERE action_type = 'client.error'
      AND created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_audit_deleted_errors = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('audit_errors', SQLERRM);
  END;

  -- 3. Delete old update audit rows (>90d)
  BEGIN
    DELETE FROM public.audit_logs
    WHERE action_type LIKE '%.update'
      AND created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_audit_deleted_old = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('audit_old_updates', SQLERRM);
  END;

  -- 4. Delete old admin edit snapshots (>90d)
  BEGIN
    DELETE FROM public.admin_edit_snapshots
    WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS v_admin_snapshots_deleted = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('admin_snapshots', SQLERRM);
  END;

  -- 5. Trim cron.job_run_details (>7d) — was 1.9 GB / 74% of DB
  BEGIN
    DELETE FROM cron.job_run_details
    WHERE end_time < NOW() - INTERVAL '7 days'
       OR (end_time IS NULL AND start_time < NOW() - INTERVAL '7 days');
    GET DIAGNOSTICS v_cron_runs_deleted = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('cron_run_details', SQLERRM);
  END;

  -- 6. Trim backup_history rows for daily backups older than 14 days.
  -- The storage objects themselves are pruned by the prune-old-backups edge
  -- function (cannot DELETE from storage.objects directly).
  BEGIN
    DELETE FROM public.backup_history
    WHERE created_at < NOW() - INTERVAL '14 days'
      AND file_path LIKE 'daily/%';
    GET DIAGNOSTICS v_backup_history_deleted = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    v_errors := v_errors || jsonb_build_object('backup_history', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'audit_trimmed', v_audit_trimmed,
    'audit_deleted_client_errors', v_audit_deleted_errors,
    'audit_deleted_old_updates', v_audit_deleted_old,
    'admin_snapshots_deleted', v_admin_snapshots_deleted,
    'cron_run_details_deleted', v_cron_runs_deleted,
    'backup_history_deleted', v_backup_history_deleted,
    'errors', v_errors,
    'ran_at', NOW()
  );
END;
$function$;