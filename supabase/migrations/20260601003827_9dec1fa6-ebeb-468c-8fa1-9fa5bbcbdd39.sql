-- Audit trigger for public.training_summary
-- Rationale: the existing fn_audit_table_change() references OLD.deleted_at,
-- OLD.status, OLD.inspector_id — none of which exist on training_summary.
-- This is a tailored helper that records only the four body fields, capped at
-- 16KB each, with the parent training_id in metadata for lookup.

CREATE OR REPLACE FUNCTION public.fn_audit_training_summary_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_record_id uuid;
  v_training_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'training_summary.insert';
    v_record_id := NEW.id;
    v_training_id := NEW.training_id;
    v_old := NULL;
    v_new := jsonb_build_object(
      'observations', NEW.observations,
      'recommendations', NEW.recommendations,
      'person_submitting', NEW.person_submitting,
      'submission_date', NEW.submission_date
    );
    v_changed := true;

  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'training_summary.update';
    v_record_id := NEW.id;
    v_training_id := NEW.training_id;
    -- Only record an audit row when one of the four body fields actually changed.
    IF (OLD.observations      IS DISTINCT FROM NEW.observations)
    OR (OLD.recommendations   IS DISTINCT FROM NEW.recommendations)
    OR (OLD.person_submitting IS DISTINCT FROM NEW.person_submitting)
    OR (OLD.submission_date   IS DISTINCT FROM NEW.submission_date) THEN
      v_changed := true;
      v_old := jsonb_build_object(
        'observations', OLD.observations,
        'recommendations', OLD.recommendations,
        'person_submitting', OLD.person_submitting,
        'submission_date', OLD.submission_date
      );
      v_new := jsonb_build_object(
        'observations', NEW.observations,
        'recommendations', NEW.recommendations,
        'person_submitting', NEW.person_submitting,
        'submission_date', NEW.submission_date
      );
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'training_summary.delete';
    v_record_id := OLD.id;
    v_training_id := OLD.training_id;
    v_old := jsonb_build_object(
      'observations', OLD.observations,
      'recommendations', OLD.recommendations,
      'person_submitting', OLD.person_submitting,
      'submission_date', OLD.submission_date
    );
    v_new := NULL;
    v_changed := true;
  END IF;

  IF NOT v_changed THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 16 KB cap per side (matches fn_audit_table_change pattern).
  IF v_old IS NOT NULL AND octet_length(v_old::text) > 16384 THEN
    v_old := jsonb_build_object('_truncated', true);
  END IF;
  IF v_new IS NOT NULL AND octet_length(v_new::text) > 16384 THEN
    v_new := jsonb_build_object('_truncated', true);
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action_type, table_name, record_id,
    old_values, new_values, metadata
  ) VALUES (
    auth.uid(), v_action, 'training_summary', v_record_id,
    v_old, v_new,
    jsonb_build_object(
      'op', TG_OP,
      'schema', TG_TABLE_SCHEMA,
      'training_id', v_training_id
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying write because of audit bookkeeping.
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_training_summary ON public.training_summary;
CREATE TRIGGER trg_audit_training_summary
AFTER INSERT OR UPDATE OR DELETE ON public.training_summary
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_training_summary_change();
