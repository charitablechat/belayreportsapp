-- Remove the email_address column from notification_preferences
-- This data should only exist in auth.users for security
ALTER TABLE public.notification_preferences DROP COLUMN IF EXISTS email_address;