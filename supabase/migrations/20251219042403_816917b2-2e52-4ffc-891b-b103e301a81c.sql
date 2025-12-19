-- Add restrictive RLS policies for webhook_config table
-- This table stores sensitive webhook secrets and should only be accessed
-- by SECURITY DEFINER functions (like internal_get_webhook_secret), not directly by users

-- Policy to deny all SELECT operations for regular users
CREATE POLICY "Deny all direct access to webhook_config"
ON public.webhook_config
FOR ALL
USING (false)
WITH CHECK (false);

-- Add a comment explaining the security model
COMMENT ON TABLE public.webhook_config IS 'Stores sensitive webhook secrets. Direct access is denied to all users. Access is only through SECURITY DEFINER functions like internal_get_webhook_secret().';