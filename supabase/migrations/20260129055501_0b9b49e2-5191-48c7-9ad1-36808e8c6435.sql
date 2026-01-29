-- Create global_field_history table for cross-report element name memory
CREATE TABLE public.global_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_type TEXT NOT NULL,
  value TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(field_type, value)
);

-- Create index for efficient lookups
CREATE INDEX idx_global_field_history_field_type ON public.global_field_history(field_type);
CREATE INDEX idx_global_field_history_usage ON public.global_field_history(field_type, usage_count DESC);

-- Enable RLS
ALTER TABLE public.global_field_history ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read global history
CREATE POLICY "Authenticated users can read global history"
ON public.global_field_history FOR SELECT
TO authenticated
USING (true);

-- All authenticated users can insert (upsert pattern)
CREATE POLICY "Authenticated users can insert global history"
ON public.global_field_history FOR INSERT
TO authenticated
WITH CHECK (true);

-- All authenticated users can update (for usage_count increments)
CREATE POLICY "Authenticated users can update global history"
ON public.global_field_history FOR UPDATE
TO authenticated
USING (true);

-- Add comment describing the table purpose
COMMENT ON TABLE public.global_field_history IS 'Stores element names for cross-report autocomplete suggestions. Shared across all users for collaborative data entry.';