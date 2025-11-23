-- Create function to merge organizations
CREATE OR REPLACE FUNCTION merge_organizations(
  p_source_org_ids UUID[],
  p_target_org_id UUID,
  p_new_name TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected_inspections INTEGER;
  v_affected_members INTEGER;
  v_affected_conflicts INTEGER;
  v_deleted_orgs INTEGER;
BEGIN
  -- Security check: only super admins can merge organizations
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  -- Validate target organization exists
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_target_org_id) THEN
    RAISE EXCEPTION 'Target organization does not exist';
  END IF;

  -- Remove target org from source list if present
  p_source_org_ids := array_remove(p_source_org_ids, p_target_org_id);

  -- Update inspections
  UPDATE inspections
  SET organization_id = p_target_org_id
  WHERE organization_id = ANY(p_source_org_ids);
  GET DIAGNOSTICS v_affected_inspections = ROW_COUNT;

  -- Update organization members (with conflict resolution)
  -- First, delete duplicate memberships that would conflict
  DELETE FROM organization_members
  WHERE organization_id = ANY(p_source_org_ids)
  AND user_id IN (
    SELECT user_id 
    FROM organization_members 
    WHERE organization_id = p_target_org_id
  );

  -- Then update remaining memberships
  UPDATE organization_members
  SET organization_id = p_target_org_id
  WHERE organization_id = ANY(p_source_org_ids);
  GET DIAGNOSTICS v_affected_members = ROW_COUNT;

  -- Update sync conflicts
  UPDATE sync_conflicts
  SET organization_id = p_target_org_id
  WHERE organization_id = ANY(p_source_org_ids);
  GET DIAGNOSTICS v_affected_conflicts = ROW_COUNT;

  -- Update organization name if provided
  IF p_new_name IS NOT NULL AND TRIM(p_new_name) != '' THEN
    UPDATE organizations
    SET name = TRIM(p_new_name), updated_at = NOW()
    WHERE id = p_target_org_id;
  END IF;

  -- Delete merged organizations
  DELETE FROM organizations
  WHERE id = ANY(p_source_org_ids);
  GET DIAGNOSTICS v_deleted_orgs = ROW_COUNT;

  -- Return summary
  RETURN jsonb_build_object(
    'success', true,
    'inspections_updated', v_affected_inspections,
    'members_updated', v_affected_members,
    'conflicts_updated', v_affected_conflicts,
    'organizations_deleted', v_deleted_orgs,
    'target_organization_id', p_target_org_id
  );
END;
$$;

-- Create function to find potential duplicate organizations
CREATE OR REPLACE FUNCTION find_duplicate_organizations()
RETURNS TABLE(
  group_key TEXT,
  org_ids UUID[],
  org_names TEXT[],
  total_inspections BIGINT,
  total_members BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security check: only super admins can view duplicates
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  RETURN QUERY
  WITH normalized_orgs AS (
    SELECT 
      id,
      name,
      LOWER(TRIM(REGEXP_REPLACE(name, '\s+', ' ', 'g'))) as normalized_name
    FROM organizations
  ),
  grouped_orgs AS (
    SELECT 
      normalized_name,
      array_agg(id ORDER BY name) as org_ids,
      array_agg(name ORDER BY name) as org_names,
      COUNT(*) as duplicate_count
    FROM normalized_orgs
    GROUP BY normalized_name
    HAVING COUNT(*) > 1
  )
  SELECT 
    g.normalized_name,
    g.org_ids,
    g.org_names,
    COALESCE(SUM((
      SELECT COUNT(*) 
      FROM inspections 
      WHERE organization_id = ANY(g.org_ids)
    )), 0) as total_inspections,
    COALESCE(SUM((
      SELECT COUNT(*) 
      FROM organization_members 
      WHERE organization_id = ANY(g.org_ids)
    )), 0) as total_members
  FROM grouped_orgs g
  ORDER BY g.normalized_name;
END;
$$;