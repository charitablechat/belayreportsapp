-- Add training_completed column to notification_preferences
ALTER TABLE notification_preferences 
ADD COLUMN IF NOT EXISTS training_completed BOOLEAN DEFAULT true;

-- Create function for training completion notifications  
CREATE OR REPLACE FUNCTION public.notify_super_admins_training_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    
    -- Call edge function with proper authentication
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
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
$$;

-- Create trigger for inspection completion notifications (if not exists)
DROP TRIGGER IF EXISTS on_inspection_completed ON public.inspections;
CREATE TRIGGER on_inspection_completed
  AFTER UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_inspection_completed();

-- Create trigger for training completion notifications
DROP TRIGGER IF EXISTS on_training_completed ON public.trainings;
CREATE TRIGGER on_training_completed
  AFTER UPDATE ON public.trainings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_training_completed();