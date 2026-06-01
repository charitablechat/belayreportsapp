-- Self-Service Restore / Fill Missing Fields (Trainings, Observations/Recommendations only).
-- One atomic SECURITY DEFINER function. No table, RLS, or trigger changes.

CREATE OR REPLACE FUNCTION public.self_service_fill_missing_training_field(
  p_training_id           uuid,
  p_field                 text,
  p_recovered_text        text,
  p_scan_seen_updated_at  timestamptz DEFAULT NULL,
  p_client_metadata       jsonb       DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user                uuid := auth.uid();
  v_owner               uuid;
  v_server_updated_at   timestamptz;
  v_normalized          text;
  v_summary_id          uuid;
  v_snapshot_id         uuid;
  v_existing_obs        text;
  v_existing_recs       text;
  v_existing_field_val  text;
  v_snapshot_payload    jsonb;
  v_meta                jsonb := COALESCE(p_client_metadata, '{}'::jsonb);
BEGIN
  -- 1. Auth gate.
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  END IF;

  -- 2. Allow-listed field only. No dynamic SQL on column names anywhere below.
  IF p_field IS NULL OR p_field NOT IN ('observations', 'recommendations') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_field');
  END IF;

  -- 3. Normalize and require non-empty text after trim.
  v_normalized := btrim(COALESCE(p_recovered_text, ''));
  IF v_normalized = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_recovered_text');
  END IF;

  -- 4. Lock the parent training row, capture owner + updated_at.
  SELECT inspector_id, updated_at
    INTO v_owner, v_server_updated_at
    FROM public.trainings
   WHERE id = p_training_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'training_not_found');
  END IF;

  -- Owner-or-admin authorization (UI restricts to owner; admin path here mirrors
  -- existing admin RLS on training_summary so this function never exceeds the
  -- caller's existing direct-table permissions).
  IF v_owner IS DISTINCT FROM v_user AND NOT public.is_admin_or_above() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  -- 5. Freshness check: refuse if the parent advanced since the scan.
  IF p_scan_seen_updated_at IS NOT NULL
     AND v_server_updated_at IS NOT NULL
     AND v_server_updated_at > p_scan_seen_updated_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'needs_rescan',
      'server_updated_at', v_server_updated_at
    );
  END IF;

  -- 6. Ensure a summary row exists (idempotent; the unique index on training_id
  -- guarantees a single row). Only training_id is required; all body columns
  -- are nullable.
  INSERT INTO public.training_summary (training_id)
  VALUES (p_training_id)
  ON CONFLICT (training_id) DO NOTHING;

  -- Re-read the current values for the blank-only enforcement and the snapshot
  -- payload (previous_value).
  SELECT id, observations, recommendations
    INTO v_summary_id, v_existing_obs, v_existing_recs
    FROM public.training_summary
   WHERE training_id = p_training_id;

  IF v_summary_id IS NULL THEN
    -- Should be impossible after the upsert; treat as a conflict.
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
  END IF;

  v_existing_field_val := CASE p_field
    WHEN 'observations'    THEN v_existing_obs
    WHEN 'recommendations' THEN v_existing_recs
  END;

  IF v_existing_field_val IS NOT NULL AND btrim(v_existing_field_val) <> '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'field_populated');
  END IF;

  -- 7. App-level snapshot BEFORE the field write. Both rows commit together or
  -- roll back together because we are inside a single transaction.
  v_snapshot_payload := jsonb_build_object(
    'source',           'recovery_and_sync_health',
    'action_type',      'self_service_fill_missing_field',
    'training_id',      p_training_id,
    'field',            p_field,
    'previous_value',   NULL,
    'restored_length',  length(v_normalized),
    'scan_seen_updated_at', p_scan_seen_updated_at,
    'app_version',      v_meta -> 'app_version',
    'user_agent',       v_meta -> 'user_agent',
    'scan_token',       v_meta -> 'scan_token'
  );

  INSERT INTO public.admin_edit_snapshots (
    report_id, report_type, edited_by, original_owner_id, snapshot_data
  ) VALUES (
    p_training_id, 'training', v_user, v_owner, v_snapshot_payload
  )
  RETURNING id INTO v_snapshot_id;

  -- 8. Blank-only conditional update on the chosen field. Two literal arms; no
  -- dynamic SQL. WHERE clause enforces blank-only at the database level so the
  -- check and the write are inseparable.
  IF p_field = 'observations' THEN
    UPDATE public.training_summary
       SET observations = v_normalized
     WHERE training_id = p_training_id
       AND (observations IS NULL OR btrim(observations) = '');
  ELSE
    UPDATE public.training_summary
       SET recommendations = v_normalized
     WHERE training_id = p_training_id
       AND (recommendations IS NULL OR btrim(recommendations) = '');
  END IF;

  IF NOT FOUND THEN
    -- Race: someone populated the field between the lock and the update. Roll
    -- back the snapshot by raising; the transaction unwind below converts to a
    -- typed result.
    RAISE EXCEPTION 'field_populated_race' USING ERRCODE = 'check_violation';
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'training_id',     p_training_id,
    'field',           p_field,
    'summary_id',      v_summary_id,
    'snapshot_id',     v_snapshot_id,
    'server_updated_at', v_server_updated_at,
    'restored_length', length(v_normalized)
  );

EXCEPTION
  WHEN check_violation THEN
    IF SQLERRM = 'field_populated_race' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'field_populated');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'internal_error', 'detail', SQLERRM);
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'internal_error', 'detail', SQLERRM);
END;
$function$;

-- Lock down execution: signed-in users only. Edge functions/anon never call this.
REVOKE ALL ON FUNCTION public.self_service_fill_missing_training_field(uuid, text, text, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.self_service_fill_missing_training_field(uuid, text, text, timestamptz, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.self_service_fill_missing_training_field(uuid, text, text, timestamptz, jsonb) TO authenticated;

COMMENT ON FUNCTION public.self_service_fill_missing_training_field(uuid, text, text, timestamptz, jsonb) IS
  'Atomic owner-only fill of one blank training_summary field (observations or recommendations). Writes app-level snapshot + field update in a single transaction; returns typed {ok:true,...} or {ok:false,reason:...} JSON. Allow-listed fields only. SECURITY DEFINER with search_path pinned.';
