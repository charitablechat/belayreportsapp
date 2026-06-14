ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS dashboard_view_mode TEXT
    CHECK (dashboard_view_mode IN ('list','split','grid'));