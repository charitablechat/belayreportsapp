
-- Update daily assessment push notification trigger to use distinct type
CREATE OR REPLACE FUNCTION public.notify_super_admins_daily_assessment_completed()
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
        'notificationType', 'daily_assessment_completed',
        'title', 'Daily Assessment Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed a daily assessment at ' || COALESCE(NEW.site, 'unknown site'),
        'data', jsonb_build_object('assessmentId', NEW.id, 'organization', v_org_name, 'location', NEW.site, 'inspector', v_inspector_name)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Update daily assessment email notification trigger to use distinct type
CREATE OR REPLACE FUNCTION public.notify_super_admins_daily_assessment_email()
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
        'notificationType', 'daily_assessment_completed',
        'title', 'Daily Assessment Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed a daily assessment at ' || COALESCE(NEW.site, 'unknown site'),
        'data', jsonb_build_object('assessmentId', NEW.id, 'organization', v_org_name, 'location', NEW.site, 'inspector', v_inspector_name)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;
