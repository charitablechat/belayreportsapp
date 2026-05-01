-- Phase 1.2 — Skip no-op UPDATEs entirely on hot inspection child tables.
-- Production telemetry: ~500 updates per live row across these 4 tables in 24h.
-- Returning NULL from a BEFORE UPDATE trigger cancels the write entirely
-- (no row update, no WAL, no index churn, no autovacuum work, no realtime fanout).

CREATE OR REPLACE FUNCTION public.skip_noop_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_compare jsonb;
  new_compare jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Strip bookkeeping columns before comparing — same set used by
  -- update_updated_at_column() so behavior is consistent.
  old_compare := to_jsonb(OLD)
    - 'updated_at' - 'synced_at' - 'last_opened_at'
    - 'last_modified_by' - 'latest_report_generated_at'
    - 'latest_report_html' - 'report_version' - 'last_sync_source';
  new_compare := to_jsonb(NEW)
    - 'updated_at' - 'synced_at' - 'last_opened_at'
    - 'last_modified_by' - 'latest_report_generated_at'
    - 'latest_report_html' - 'report_version' - 'last_sync_source';

  IF old_compare = new_compare THEN
    -- Cancel the write entirely.
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach BEFORE the existing update_updated_at_column trigger so we short-circuit early.
-- Trigger names sort alphabetically; "a_skip" prefix ensures it fires first.

DROP TRIGGER IF EXISTS a_skip_noop_update ON public.inspection_equipment;
CREATE TRIGGER a_skip_noop_update
  BEFORE UPDATE ON public.inspection_equipment
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_update();

DROP TRIGGER IF EXISTS a_skip_noop_update ON public.inspection_systems;
CREATE TRIGGER a_skip_noop_update
  BEFORE UPDATE ON public.inspection_systems
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_update();

DROP TRIGGER IF EXISTS a_skip_noop_update ON public.inspection_standards;
CREATE TRIGGER a_skip_noop_update
  BEFORE UPDATE ON public.inspection_standards
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_update();

DROP TRIGGER IF EXISTS a_skip_noop_update ON public.inspection_ziplines;
CREATE TRIGGER a_skip_noop_update
  BEFORE UPDATE ON public.inspection_ziplines
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_update();