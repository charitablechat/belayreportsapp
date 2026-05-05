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
    'field_timestamps','attestation_text','attestation_user_agent',
    'trainee_names','repairs_performed','critical_actions','future_considerations',
    'comments','notes','description','sync_payload','last_sync_payload'
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
    IF v_old = v_new THEN RETURN NEW; END IF;
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

  IF v_old IS NOT NULL THEN FOREACH k IN ARRAY v_strip_keys LOOP v_old := v_old - k; END LOOP; END IF;
  IF v_new IS NOT NULL THEN FOREACH k IN ARRAY v_strip_keys LOOP v_new := v_new - k; END LOOP; END IF;

  IF v_action = TG_TABLE_NAME || '.update' THEN
    IF v_old IS NOT NULL THEN
      v_old := jsonb_build_object('status', v_old->'status', 'inspector_id', v_old->'inspector_id', 'deleted_at', v_old->'deleted_at', 'updated_at', v_old->'updated_at');
    END IF;
    IF v_new IS NOT NULL THEN
      v_new := jsonb_build_object('status', v_new->'status', 'inspector_id', v_new->'inspector_id', 'deleted_at', v_new->'deleted_at', 'updated_at', v_new->'updated_at');
    END IF;
  END IF;

  IF v_old IS NOT NULL AND octet_length(v_old::text) > 16384 THEN v_old := NULL; END IF;
  IF v_new IS NOT NULL AND octet_length(v_new::text) > 16384 THEN v_new := NULL; END IF;

  INSERT INTO public.audit_logs (user_id, action_type, table_name, record_id, old_values, new_values, metadata)
  VALUES (auth.uid(), v_action, TG_TABLE_NAME, v_record_id, v_old, v_new, jsonb_build_object('op', TG_OP, 'schema', TG_TABLE_SCHEMA));

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$function$;