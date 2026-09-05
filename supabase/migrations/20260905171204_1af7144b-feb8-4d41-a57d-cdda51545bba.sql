-- Recipients for account activity alerts
CREATE TABLE public.account_notify_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_notify_recipients TO authenticated;
GRANT ALL ON public.account_notify_recipients TO service_role;

ALTER TABLE public.account_notify_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage account notify recipients"
ON public.account_notify_recipients
FOR ALL
TO authenticated
USING (public.is_admin_or_above())
WITH CHECK (public.is_admin_or_above());

CREATE TRIGGER update_account_notify_recipients_updated_at
BEFORE UPDATE ON public.account_notify_recipients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.account_notify_recipients (email)
VALUES ('kale@belayreports.com')
ON CONFLICT (email) DO NOTHING;

-- Single-row state for the daily summary window
CREATE TABLE public.account_notify_state (
  id BOOLEAN NOT NULL DEFAULT true PRIMARY KEY,
  last_summary_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_notify_state_singleton CHECK (id)
);

GRANT ALL ON public.account_notify_state TO service_role;

ALTER TABLE public.account_notify_state ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_account_notify_state_updated_at
BEFORE UPDATE ON public.account_notify_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.account_notify_state (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Shared caller for the notification edge function
CREATE OR REPLACE FUNCTION public.run_account_activity_notify(_mode TEXT, _payload JSONB DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret TEXT;
BEGIN
  v_secret := public.internal_get_webhook_secret();

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

-- Event-driven: fire the alert when the new account's profile row is created
CREATE OR REPLACE FUNCTION public.notify_new_account_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.run_account_activity_notify(
    'new_account',
    jsonb_build_object('userId', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS notify_new_account_created_trigger ON public.profiles;

CREATE TRIGGER notify_new_account_created_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.notify_new_account_created();

-- Daily sign-in summary
DO $$
BEGIN
  PERFORM cron.unschedule('account-daily-signin-summary');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'account-daily-signin-summary',
  '0 12 * * *',
  $$ SELECT public.run_account_activity_notify('daily_summary'); $$
);