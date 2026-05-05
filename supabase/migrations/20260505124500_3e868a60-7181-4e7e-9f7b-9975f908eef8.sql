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
    AND created_at < NOW() - INTERVAL '3 days'
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