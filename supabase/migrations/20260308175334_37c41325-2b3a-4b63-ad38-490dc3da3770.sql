-- Weekly trigger health check via pg_cron
-- Logs a warning to notifications_log if trigger count drops below expected

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule weekly trigger health check (every Sunday at 3am UTC)
SELECT cron.schedule(
  'weekly-trigger-health-check',
  '0 3 * * 0',
  $$
  DO $check$
  DECLARE
    v_result jsonb;
  BEGIN
    SELECT public.check_trigger_health() INTO v_result;
    
    IF NOT (v_result->>'healthy')::boolean THEN
      -- Log alert to notifications_log for super admin visibility
      INSERT INTO public.notifications_log (user_id, notification_type, title, body, status, data)
      SELECT 
        ur.user_id,
        'system_alert',
        'Trigger Health Warning',
        'Expected ' || (v_result->>'expected_count') || ' triggers but found ' || (v_result->>'active_count'),
        'sent',
        v_result
      FROM public.user_roles ur
      WHERE ur.role = 'super_admin';
      
      RAISE WARNING 'Trigger health check FAILED: % of % triggers active', 
        v_result->>'active_count', v_result->>'expected_count';
    END IF;
  END $check$;
  $$
);