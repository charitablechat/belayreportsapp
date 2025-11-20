-- Drop and recreate the notify_super_admins_inspection_completed function
-- This fixes the error where it tried to access NEW.inspector_name which doesn't exist

CREATE OR REPLACE FUNCTION public.notify_super_admins_inspection_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inspector_name TEXT;
  v_org_name TEXT;
  v_service_role_key TEXT;
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
    
    -- Use inspector_id as ultimate fallback if profile not found
    v_inspector_name := COALESCE(v_inspector_name, NEW.inspector_id::TEXT);
    
    -- Get service role key for authentication
    v_service_role_key := get_service_role_key();
    
    -- Call edge function with proper authentication
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'inspection_completed',
        'title', 'Inspection Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed inspection at ' || COALESCE(NEW.location, 'unknown location'),
        'data', jsonb_build_object(
          'inspectionId', NEW.id,
          'organization', v_org_name,
          'location', NEW.location
        )
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$;