-- SECURITY FIX: Remove vulnerable get_service_role_key() function
-- This function exposed the service role key to any authenticated user

-- Step 1: Drop the vulnerable function immediately
DROP FUNCTION IF EXISTS public.get_service_role_key();

-- Step 2: Create a secure webhook secret retrieval function
-- This function can ONLY be called internally by database triggers (security definer context)
-- It retrieves the WEBHOOK_SECRET from vault instead of the service role key
CREATE OR REPLACE FUNCTION internal_get_webhook_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  webhook_key TEXT;
BEGIN
  -- Retrieve the WEBHOOK_SECRET from vault
  -- This is only called from trigger context, never directly by users
  SELECT decrypted_secret INTO webhook_key
  FROM vault.decrypted_secrets
  WHERE name = 'WEBHOOK_SECRET'
  LIMIT 1;
  
  -- If no webhook secret is set, return NULL (edge function will reject)
  RETURN webhook_key;
END;
$$;

-- CRITICAL: Revoke execute permission from all user roles
-- This function should only be callable from SECURITY DEFINER trigger functions
REVOKE EXECUTE ON FUNCTION internal_get_webhook_secret() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION internal_get_webhook_secret() FROM anon;
REVOKE EXECUTE ON FUNCTION internal_get_webhook_secret() FROM authenticated;

-- Step 3: Update notify_super_admins_inspection_completed to use webhook auth
CREATE OR REPLACE FUNCTION public.notify_super_admins_inspection_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
    
    -- Call edge function with webhook authentication
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_webhook_secret
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
$$;

-- Step 4: Update notify_super_admins_training_completed to use webhook auth
CREATE OR REPLACE FUNCTION public.notify_super_admins_training_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_trainer_name TEXT;
  v_org_name TEXT;
  v_webhook_secret TEXT;
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
    
    -- Get webhook secret for authentication
    v_webhook_secret := internal_get_webhook_secret();
    
    -- Call edge function with webhook authentication
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', v_webhook_secret
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

-- Step 5: Update notify_super_admins_inspection_email to use webhook auth
CREATE OR REPLACE FUNCTION public.notify_super_admins_inspection_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
$$;

-- Step 6: Update notify_super_admins_training_email to use webhook auth
CREATE OR REPLACE FUNCTION public.notify_super_admins_training_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_trainer_name TEXT;
  v_org_name TEXT;
  v_webhook_secret TEXT;
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

-- Step 7: Update notify_super_admins_sync_conflict to use webhook auth
CREATE OR REPLACE FUNCTION public.notify_super_admins_sync_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_webhook_secret TEXT;
BEGIN
  -- Get webhook secret for authentication
  v_webhook_secret := internal_get_webhook_secret();
  
  -- Call edge function with webhook authentication
  PERFORM net.http_post(
    url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object(
      'organizationId', NEW.organization_id,
      'notificationType', 'sync_conflict',
      'title', 'Sync Conflict Detected',
      'body', 'A sync conflict occurred for inspection ' || NEW.inspection_id::TEXT,
      'data', jsonb_build_object(
        'conflictId', NEW.id,
        'inspectionId', NEW.inspection_id
      )
    )
  );
  
  RETURN NEW;
END;
$$;