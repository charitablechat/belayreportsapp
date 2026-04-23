-- Add backup_operator to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'backup_operator';
