
-- Fix: Restrict "Service role can upload PDFs" to actually require service_role.
DROP POLICY IF EXISTS "Service role can upload PDFs" ON storage.objects;
CREATE POLICY "Service role can upload PDFs"
  ON storage.objects
  FOR INSERT
  TO public
  WITH CHECK (
    bucket_id = 'inspection-reports'::text
    AND auth.role() = 'service_role'
  );

-- Fix: Explicitly deny client-side INSERT into audit_logs.
-- Triggers run as the table owner and are not subject to RLS, so audit
-- writes from server-side triggers continue to work. Service-role callers
-- also bypass RLS. This restrictive policy blocks anon/authenticated.
DROP POLICY IF EXISTS "Deny client inserts on audit_logs" ON public.audit_logs;
CREATE POLICY "Deny client inserts on audit_logs"
  ON public.audit_logs
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);
