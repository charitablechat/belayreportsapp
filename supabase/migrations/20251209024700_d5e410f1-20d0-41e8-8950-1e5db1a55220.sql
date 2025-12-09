-- Add email notification preferences columns to notification_preferences table
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_inspection_completed boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS email_training_completed boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS email_sync_conflicts boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_address text;