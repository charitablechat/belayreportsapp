-- =====================================================
-- IMMUTABLE INSPECTOR_ID: Prevent modification after creation
-- =====================================================

-- Function to prevent inspector_id modification
CREATE OR REPLACE FUNCTION public.prevent_inspector_id_change()
RETURNS TRIGGER AS $$
BEGIN
  -- If inspector_id is being changed, reject the update
  IF OLD.inspector_id IS NOT NULL AND NEW.inspector_id IS DISTINCT FROM OLD.inspector_id THEN
    RAISE EXCEPTION 'inspector_id cannot be modified after creation. The report owner is permanently set.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply trigger to inspections table
DROP TRIGGER IF EXISTS prevent_inspector_id_change_inspections ON public.inspections;
CREATE TRIGGER prevent_inspector_id_change_inspections
  BEFORE UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_inspector_id_change();

-- Apply trigger to trainings table
DROP TRIGGER IF EXISTS prevent_inspector_id_change_trainings ON public.trainings;
CREATE TRIGGER prevent_inspector_id_change_trainings
  BEFORE UPDATE ON public.trainings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_inspector_id_change();

-- Apply trigger to daily_assessments table
DROP TRIGGER IF EXISTS prevent_inspector_id_change_daily_assessments ON public.daily_assessments;
CREATE TRIGGER prevent_inspector_id_change_daily_assessments
  BEFORE UPDATE ON public.daily_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_inspector_id_change();

-- =====================================================
-- SUPER ADMIN VIEW-ONLY ACCESS: Remove UPDATE permissions
-- =====================================================

-- Drop existing super admin update policies on inspections
DROP POLICY IF EXISTS "Super admins can update all inspections" ON public.inspections;

-- Drop existing super admin update policies on trainings
DROP POLICY IF EXISTS "Super admins can update all trainings" ON public.trainings;

-- Drop existing super admin update policies on daily_assessments
DROP POLICY IF EXISTS "Super admins can update all assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Super admins can update all daily assessments" ON public.daily_assessments;

-- =====================================================
-- FUNCTION: Check if user is report owner (for frontend use)
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_report_owner(report_inspector_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT report_inspector_id = auth.uid()
$$;

-- =====================================================
-- FUNCTION: Check if current user can edit a report
-- Returns true only if user is the original inspector (owner)
-- Super admins explicitly CANNOT edit - they are view-only
-- =====================================================

CREATE OR REPLACE FUNCTION public.can_edit_report(report_inspector_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT report_inspector_id = auth.uid()
$$;