
-- Create the report_cloud_backups table
CREATE TABLE public.report_cloud_backups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  report_type text NOT NULL,
  report_id text NOT NULL,
  device text NOT NULL DEFAULT 'desktop',
  synced boolean NOT NULL DEFAULT false,
  snapshot_data jsonb NOT NULL,
  snapshot_ts bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one cloud backup per report per user
ALTER TABLE public.report_cloud_backups
  ADD CONSTRAINT report_cloud_backups_user_report_unique
  UNIQUE (user_id, report_type, report_id);

-- Index for fast lookups by user
CREATE INDEX idx_report_cloud_backups_user_id ON public.report_cloud_backups (user_id);

-- Index for ordering by snapshot timestamp
CREATE INDEX idx_report_cloud_backups_snapshot_ts ON public.report_cloud_backups (snapshot_ts DESC);

-- Enable RLS
ALTER TABLE public.report_cloud_backups ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only read their own backups
CREATE POLICY "Users can read own cloud backups"
  ON public.report_cloud_backups
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS: Users can insert their own backups
CREATE POLICY "Users can insert own cloud backups"
  ON public.report_cloud_backups
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS: Users can update their own backups (for upsert)
CREATE POLICY "Users can update own cloud backups"
  ON public.report_cloud_backups
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS: Users can delete their own backups
CREATE POLICY "Users can delete own cloud backups"
  ON public.report_cloud_backups
  FOR DELETE
  USING (auth.uid() = user_id);
