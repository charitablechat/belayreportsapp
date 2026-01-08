-- Add latest_report_url and report sync tracking columns to relevant tables
-- This enables "latest report" pointer functionality for automatic syncing

-- Add report tracking to daily_assessments
ALTER TABLE public.daily_assessments 
ADD COLUMN IF NOT EXISTS latest_report_html TEXT,
ADD COLUMN IF NOT EXISTS latest_report_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS report_version INTEGER DEFAULT 0;

-- Add report tracking to trainings
ALTER TABLE public.trainings 
ADD COLUMN IF NOT EXISTS latest_report_html TEXT,
ADD COLUMN IF NOT EXISTS latest_report_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS report_version INTEGER DEFAULT 0;

-- Add report tracking to inspections
ALTER TABLE public.inspections 
ADD COLUMN IF NOT EXISTS latest_report_html TEXT,
ADD COLUMN IF NOT EXISTS latest_report_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS report_version INTEGER DEFAULT 0;

-- Create indexes for efficient report queries
CREATE INDEX IF NOT EXISTS idx_daily_assessments_report_generated ON public.daily_assessments(latest_report_generated_at DESC) WHERE latest_report_generated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trainings_report_generated ON public.trainings(latest_report_generated_at DESC) WHERE latest_report_generated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inspections_report_generated ON public.inspections(latest_report_generated_at DESC) WHERE latest_report_generated_at IS NOT NULL;

-- Enable realtime for these tables to support live UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_assessments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trainings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inspections;

-- Comment explaining the design:
-- We use a "latest pointer" approach where each entity (inspection, training, assessment)
-- stores its own latest_report_html and report_version. This is atomic because:
-- 1. The report HTML and version are updated in a single database row update
-- 2. Upsert ensures no partial state (either both fields update or neither)
-- 3. report_version increments monotonically, preventing stale overwrites
-- 4. Realtime subscriptions allow UI to auto-refresh when new reports are saved