CREATE OR REPLACE FUNCTION public.check_trigger_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
  v_expected INTEGER := 27;
  v_triggers jsonb;
BEGIN
  SELECT COUNT(*), jsonb_agg(jsonb_build_object('name', tgname, 'table', relname))
  INTO v_count, v_triggers
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND NOT t.tgisinternal;
  
  RETURN jsonb_build_object(
    'healthy', v_count >= v_expected,
    'active_count', v_count,
    'expected_count', v_expected,
    'triggers', COALESCE(v_triggers, '[]'::jsonb)
  );
END;
$function$;