-- Create table for storing user's previously entered field values
CREATE TABLE public.user_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  field_type TEXT NOT NULL,
  value TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, field_type, value)
);

-- Create index for faster lookups
CREATE INDEX idx_user_field_history_lookup ON public.user_field_history(user_id, field_type);
CREATE INDEX idx_user_field_history_usage ON public.user_field_history(user_id, field_type, usage_count DESC);

-- Enable RLS
ALTER TABLE public.user_field_history ENABLE ROW LEVEL SECURITY;

-- Users can only view their own field history
CREATE POLICY "Users can view their own field history"
  ON public.user_field_history
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own field history
CREATE POLICY "Users can insert their own field history"
  ON public.user_field_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own field history
CREATE POLICY "Users can update their own field history"
  ON public.user_field_history
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own field history
CREATE POLICY "Users can delete their own field history"
  ON public.user_field_history
  FOR DELETE
  USING (auth.uid() = user_id);