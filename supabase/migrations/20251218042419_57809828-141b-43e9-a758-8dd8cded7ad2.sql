-- Step 1: Create webhook_config table for storing webhook secret
CREATE TABLE IF NOT EXISTS public.webhook_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name text UNIQUE NOT NULL,
  key_value text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS (policies will block ALL direct access - only SECURITY DEFINER functions can read)
ALTER TABLE public.webhook_config ENABLE ROW LEVEL SECURITY;

-- No RLS policies = no direct access from client
-- The SECURITY DEFINER function below will bypass RLS

-- Step 2: Update internal_get_webhook_secret() to read from webhook_config table
CREATE OR REPLACE FUNCTION public.internal_get_webhook_secret()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  webhook_key TEXT;
BEGIN
  -- Retrieve the WEBHOOK_SECRET from webhook_config table
  -- This is only called from trigger context, never directly by users
  SELECT key_value INTO webhook_key
  FROM public.webhook_config
  WHERE key_name = 'WEBHOOK_SECRET'
  LIMIT 1;
  
  -- If no webhook secret is set, return NULL (edge function will reject)
  RETURN webhook_key;
END;
$function$;

-- Step 3: Insert the webhook secret (use the same value you set in edge function secrets)
-- IMPORTANT: Replace 'YOUR_WEBHOOK_SECRET_HERE' with your actual webhook secret before running!
INSERT INTO public.webhook_config (key_name, key_value)
VALUES ('WEBHOOK_SECRET', 'YOUR_WEBHOOK_SECRET_HERE')
ON CONFLICT (key_name) DO UPDATE SET key_value = EXCLUDED.key_value, updated_at = now();