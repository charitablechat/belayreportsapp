-- Create a secure function to retrieve service role key from vault
-- First, ensure we have the vault extension
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault CASCADE;

-- Create a secure function that returns the service role key
-- This function is SECURITY DEFINER so it can access vault secrets
CREATE OR REPLACE FUNCTION public.get_service_role_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_key TEXT;
BEGIN
  -- Retrieve the SUPABASE_SERVICE_ROLE_KEY from vault
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
  LIMIT 1;
  
  RETURN service_key;
END;
$$;

-- Update the notify_super_admins_inspection_completed function to use service role key
CREATE OR REPLACE FUNCTION public.notify_super_admins_inspection_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    
    -- Get inspector name (using inspector_id as fallback)
    v_inspector_name := COALESCE(NEW.inspector_name, NEW.inspector_id::TEXT);
    
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
$$;

-- Update the notify_super_admins_sync_conflict function to use service role key
CREATE OR REPLACE FUNCTION public.notify_super_admins_sync_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_role_key TEXT;
BEGIN
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