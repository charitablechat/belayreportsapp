-- Add attestation + app version columns to all three report tables
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS attestation_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attestation_signer_name TEXT,
  ADD COLUMN IF NOT EXISTS attestation_signer_id UUID,
  ADD COLUMN IF NOT EXISTS attestation_ip TEXT,
  ADD COLUMN IF NOT EXISTS attestation_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS attestation_text TEXT,
  ADD COLUMN IF NOT EXISTS app_version_at_completion TEXT;

ALTER TABLE public.trainings
  ADD COLUMN IF NOT EXISTS attestation_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attestation_signer_name TEXT,
  ADD COLUMN IF NOT EXISTS attestation_signer_id UUID,
  ADD COLUMN IF NOT EXISTS attestation_ip TEXT,
  ADD COLUMN IF NOT EXISTS attestation_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS attestation_text TEXT,
  ADD COLUMN IF NOT EXISTS app_version_at_completion TEXT;

ALTER TABLE public.daily_assessments
  ADD COLUMN IF NOT EXISTS attestation_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attestation_signer_name TEXT,
  ADD COLUMN IF NOT EXISTS attestation_signer_id UUID,
  ADD COLUMN IF NOT EXISTS attestation_ip TEXT,
  ADD COLUMN IF NOT EXISTS attestation_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS attestation_text TEXT,
  ADD COLUMN IF NOT EXISTS app_version_at_completion TEXT;

-- Edge function will populate attestation_ip server-side from request headers on first sync
-- (these columns are client-writable via existing UPDATE RLS policies on owner/admin)