
-- =============================================
-- Part 1: Daily Assessment Completion Triggers
-- =============================================

-- Push notification trigger for daily assessment completion
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
  -- Only trigger when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    
    -- Get organization name
    SELECT name INTO v_org_name
    FROM organizations
    WHERE id = NEW.organization_id;
    
    -- Get inspector name from profiles table
    SELECT COALESCE(
      NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''),
      NEW.inspector_id::TEXT
    )
    INTO v_inspector_name
    FROM profiles
    WHERE id = NEW.inspector_id;
    
    v_inspector_name := COALESCE(v_inspector_name, NEW.inspector_id::TEXT);
    
    -- Get webhook secret for authentication
    v_webhook_secret := internal_get_webhook_secret();
    
    -- Call push notification edge function
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_webhook_secret
      ),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'inspection_completed',
        'title', 'Daily Assessment Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed a daily assessment at ' || COALESCE(NEW.site, 'unknown site'),
        'data', jsonb_build_object(
          'assessmentId', NEW.id,
          'organization', v_org_name,
          'location', NEW.site,
          'inspector', v_inspector_name
        )
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Email notification trigger for daily assessment completion
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
  -- Only trigger when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    
    -- Get organization name
    SELECT name INTO v_org_name
    FROM organizations
    WHERE id = NEW.organization_id;
    
    -- Get inspector name from profiles table
    SELECT COALESCE(
      NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''),
      NEW.inspector_id::TEXT
    )
    INTO v_inspector_name
    FROM profiles
    WHERE id = NEW.inspector_id;
    
    v_inspector_name := COALESCE(v_inspector_name, NEW.inspector_id::TEXT);
    
    -- Get webhook secret for authentication
    v_webhook_secret := internal_get_webhook_secret();
    
    -- Call email notification edge function
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_webhook_secret
      ),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'inspection_completed',
        'title', 'Daily Assessment Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed a daily assessment at ' || COALESCE(NEW.site, 'unknown site'),
        'data', jsonb_build_object(
          'assessmentId', NEW.id,
          'organization', v_org_name,
          'location', NEW.site,
          'inspector', v_inspector_name
        )
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Attach triggers to daily_assessments table
CREATE TRIGGER on_daily_assessment_completed
  AFTER UPDATE ON public.daily_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_daily_assessment_completed();

CREATE TRIGGER on_daily_assessment_completed_email
  AFTER UPDATE ON public.daily_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_daily_assessment_email();

-- =============================================
-- Part 2: Notification Preferences for Overdue
-- =============================================

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS report_overdue BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_report_overdue BOOLEAN DEFAULT true;
