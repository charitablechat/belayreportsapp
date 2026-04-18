CREATE TABLE public.version_telemetry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  client_version TEXT NOT NULL,
  server_version TEXT,
  platform TEXT NOT NULL,
  user_agent TEXT,
  is_standalone BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, platform, client_version)
);

CREATE INDEX idx_version_telemetry_last_seen ON public.version_telemetry(last_seen DESC);
CREATE INDEX idx_version_telemetry_client_version ON public.version_telemetry(client_version);

ALTER TABLE public.version_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own telemetry"
ON public.version_telemetry
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own telemetry"
ON public.version_telemetry
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own telemetry"
ON public.version_telemetry
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all telemetry"
ON public.version_telemetry
FOR SELECT
TO authenticated
USING (public.is_super_admin());