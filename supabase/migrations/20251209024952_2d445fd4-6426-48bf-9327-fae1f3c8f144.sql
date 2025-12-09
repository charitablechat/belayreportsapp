-- Create function to notify super admins via email when inspection is completed
CREATE OR REPLACE FUNCTION public.notify_super_admins_inspection_email()
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
    
    v_inspector_name := COALESCE(v_inspector_name, NEW.inspector_id::TEXT);
    
    -- Get service role key for authentication
    v_service_role_key := get_service_role_key();
    
    -- Call email notification edge function
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'inspection_completed',
        'title', 'Inspection Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed an inspection at ' || COALESCE(NEW.location, 'unknown location'),
        'data', jsonb_build_object(
          'inspectionId', NEW.id,
          'organization', v_org_name,
          'location', NEW.location,
          'inspector', v_inspector_name
        )
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create function to notify super admins via email when training is completed
CREATE OR REPLACE FUNCTION public.notify_super_admins_training_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trainer_name TEXT;
  v_org_name TEXT;
  v_service_role_key TEXT;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    
    -- Get organization name
    SELECT name INTO v_org_name
    FROM organizations
    WHERE id = NEW.organization_id;
    
    -- Get trainer name from profiles table
    SELECT COALESCE(
      NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''),
      NEW.inspector_id::TEXT
    )
    INTO v_trainer_name
    FROM profiles
    WHERE id = NEW.inspector_id;
    
    v_trainer_name := COALESCE(v_trainer_name, NEW.trainer_of_record, 'Unknown');
    
    -- Get service role key for authentication
    v_service_role_key := get_service_role_key();
    
    -- Call email notification edge function
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'training_completed',
        'title', 'Training Completed',
        'body', 'Trainer ' || v_trainer_name || ' completed a training session',
        'data', jsonb_build_object(
          'trainingId', NEW.id,
          'organization', v_org_name,
          'trainer', v_trainer_name
        )
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create triggers for email notifications
DROP TRIGGER IF EXISTS on_inspection_completed_email ON public.inspections;
CREATE TRIGGER on_inspection_completed_email
  AFTER UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_inspection_email();

DROP TRIGGER IF EXISTS on_training_completed_email ON public.trainings;
CREATE TRIGGER on_training_completed_email
  AFTER UPDATE ON public.trainings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_training_email();