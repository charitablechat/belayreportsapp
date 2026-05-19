-- Add authorization to Realtime channel subscriptions.
-- Without this, any authenticated user can subscribe to any topic name.
-- Underlying row data is still protected by table RLS, but topic-level
-- access should also be scoped so users can't probe arbitrary channels.

CREATE OR REPLACE FUNCTION public.can_subscribe_realtime_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_parts text[];
  v_type text;
  v_id uuid;
  v_suffix text;
BEGIN
  -- Anonymous users cannot subscribe to any topic
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Admins and super admins can subscribe to anything (cross-org dashboards, monitoring)
  IF public.is_admin_or_above() THEN
    RETURN true;
  END IF;

  -- Global system channels: any authenticated user (no payload contains other users' data)
  IF _topic = 'global-auto-sync' THEN
    RETURN true;
  END IF;

  -- Dashboard channel: dashboard-realtime:<userId>:<scope>
  IF _topic LIKE 'dashboard-realtime:%' THEN
    v_parts := string_to_array(_topic, ':');
    IF array_length(v_parts, 1) >= 2 THEN
      BEGIN
        RETURN v_parts[2]::uuid = v_uid;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;
    END IF;
    RETURN false;
  END IF;

  -- Presence channels: report-presence:<type>:<id>
  IF _topic LIKE 'report-presence:%' THEN
    v_parts := string_to_array(_topic, ':');
    IF array_length(v_parts, 1) < 3 THEN
      RETURN false;
    END IF;
    v_type := v_parts[2];
    BEGIN
      v_id := v_parts[3]::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
  -- Per-record postgres_changes channels
  ELSIF _topic LIKE 'inspection-form-%' THEN
    v_type := 'inspection';
    v_suffix := substring(_topic from length('inspection-form-') + 1);
    BEGIN v_id := v_suffix::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  ELSIF _topic LIKE 'training-form-%' THEN
    v_type := 'training';
    v_suffix := substring(_topic from length('training-form-') + 1);
    BEGIN v_id := v_suffix::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  ELSIF _topic LIKE 'assessment-form-%' THEN
    v_type := 'daily_assessment';
    v_suffix := substring(_topic from length('assessment-form-') + 1);
    BEGIN v_id := v_suffix::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  ELSIF _topic LIKE 'report-sync-%' THEN
    -- report-sync-<entityId> covers any of the three record types; check all
    v_suffix := substring(_topic from length('report-sync-') + 1);
    BEGIN v_id := v_suffix::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
    RETURN EXISTS (SELECT 1 FROM public.inspections WHERE id = v_id AND inspector_id = v_uid)
        OR EXISTS (SELECT 1 FROM public.trainings WHERE id = v_id AND inspector_id = v_uid)
        OR EXISTS (SELECT 1 FROM public.daily_assessments WHERE id = v_id AND inspector_id = v_uid);
  ELSE
    -- Unknown topic pattern: deny for non-admins
    RETURN false;
  END IF;

  -- Verify the user owns the underlying record
  IF v_type = 'inspection' THEN
    RETURN EXISTS (SELECT 1 FROM public.inspections WHERE id = v_id AND inspector_id = v_uid);
  ELSIF v_type = 'training' THEN
    RETURN EXISTS (SELECT 1 FROM public.trainings WHERE id = v_id AND inspector_id = v_uid);
  ELSIF v_type = 'daily_assessment' THEN
    RETURN EXISTS (SELECT 1 FROM public.daily_assessments WHERE id = v_id AND inspector_id = v_uid);
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_subscribe_realtime_topic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_subscribe_realtime_topic(text) TO authenticated;

-- Drop any prior version of the policy and re-add scoped to authenticated users
DROP POLICY IF EXISTS "Authenticated users can subscribe to authorized topics" ON realtime.messages;

CREATE POLICY "Authenticated users can subscribe to authorized topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (public.can_subscribe_realtime_topic((realtime.topic())::text));