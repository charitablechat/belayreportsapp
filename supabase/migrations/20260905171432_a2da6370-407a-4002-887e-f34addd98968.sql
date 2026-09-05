CREATE OR REPLACE FUNCTION public.run_account_activity_notify(_mode TEXT, _payload JSONB DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT key_value INTO v_secret
  FROM public.webhook_config
  WHERE key_name = 'ACCOUNT_NOTIFY_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://kvoargudwekpiigopczl.supabase.co/functions/v1/notify-account-activity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object('mode', _mode) || COALESCE(_payload, '{}'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_account_activity_notify(TEXT, JSONB) FROM PUBLIC, anon, authenticated;