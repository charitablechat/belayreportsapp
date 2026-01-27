-- Add section comments columns to daily_assessments table
-- These store free-text comments for Environment, Structure, and Systems sections
-- They follow the existing soft-delete pattern (retained for 60 days when assessment is soft-deleted)

ALTER TABLE public.daily_assessments 
ADD COLUMN IF NOT EXISTS environment_comments TEXT,
ADD COLUMN IF NOT EXISTS structure_comments TEXT,
ADD COLUMN IF NOT EXISTS systems_comments TEXT;