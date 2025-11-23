-- Phase 1: Create Helper Function for Organization Lookup/Creation
CREATE OR REPLACE FUNCTION public.get_or_create_organization(org_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id UUID;
  v_normalized_name TEXT;
BEGIN
  -- Normalize the organization name (trim, handle null/empty)
  v_normalized_name := TRIM(org_name);
  
  -- Return null if empty
  IF v_normalized_name IS NULL OR v_normalized_name = '' THEN
    RETURN NULL;
  END IF;
  
  -- Try to find existing organization (case-insensitive)
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE LOWER(TRIM(name)) = LOWER(v_normalized_name)
  LIMIT 1;
  
  -- If found, return it
  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;
  
  -- Otherwise create new organization
  INSERT INTO public.organizations (name)
  VALUES (v_normalized_name)
  RETURNING id INTO v_org_id;
  
  RETURN v_org_id;
END;
$$;

-- Phase 1: Create Trigger Function
CREATE OR REPLACE FUNCTION public.auto_link_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only process if organization text field has a value
  IF NEW.organization IS NOT NULL AND TRIM(NEW.organization) != '' THEN
    -- Auto-populate organization_id if not already set
    IF NEW.organization_id IS NULL THEN
      NEW.organization_id := public.get_or_create_organization(NEW.organization);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Phase 1: Attach Trigger to Inspections Table
DROP TRIGGER IF EXISTS trigger_auto_link_organization ON public.inspections;

CREATE TRIGGER trigger_auto_link_organization
  BEFORE INSERT OR UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_organization();