
-- ============================================================
-- AUDIT LOG INFRASTRUCTURE
-- Creates indexes + SECURITY DEFINER triggers that write to
-- public.audit_logs whenever sensitive mutations occur.
-- audit_logs RLS already blocks INSERT/UPDATE/DELETE from clients;
-- only triggers (running as definer) can write.
-- ============================================================

-- ---- Indexes for fast viewer queries -----------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created
  ON public.audit_logs (table_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_record
  ON public.audit_logs (table_name, record_id);

-- ---- Generic trigger function ------------------------------
-- Writes one audit_logs row per INSERT/UPDATE/DELETE.
-- For UPDATE, only logs if any column actually changed.
CREATE OR REPLACE FUNCTION public.fn_audit_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_id uuid;
  v_action text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := TG_TABLE_NAME || '.insert';
    v_old := NULL;
    v_new := to_jsonb(NEW);
    BEGIN v_record_id := (NEW).id; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Skip no-op updates
    IF v_old = v_new THEN
      RETURN NEW;
    END IF;

    -- Detect soft-delete vs restore vs completion-lock vs ownership change
    IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
      v_action := TG_TABLE_NAME || '.soft_delete';
    ELSIF (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
      v_action := TG_TABLE_NAME || '.restore';
    ELSIF (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed') THEN
      v_action := TG_TABLE_NAME || '.complete';
    ELSIF (OLD.inspector_id IS DISTINCT FROM NEW.inspector_id) THEN
      v_action := TG_TABLE_NAME || '.reassign';
    ELSE
      v_action := TG_TABLE_NAME || '.update';
    END IF;
    BEGIN v_record_id := (NEW).id; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;

  ELSIF TG_OP = 'DELETE' THEN
    v_action := TG_TABLE_NAME || '.hard_delete';
    v_old := to_jsonb(OLD);
    v_new := NULL;
    BEGIN v_record_id := (OLD).id; EXCEPTION WHEN OTHERS THEN v_record_id := NULL; END;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action_type, table_name, record_id,
    old_values, new_values, metadata
  ) VALUES (
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_record_id,
    v_old,
    v_new,
    jsonb_build_object('op', TG_OP, 'schema', TG_TABLE_SCHEMA)
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying mutation if audit insert fails
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---- Specialized trigger for user_roles --------------------
-- Captures role grants/revokes for privilege-escalation evidence.
CREATE OR REPLACE FUNCTION public.fn_audit_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_target uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'role.grant';
    v_target := NEW.user_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'role.revoke';
    v_target := OLD.user_id;
  ELSE
    v_action := 'role.update';
    v_target := NEW.user_id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action_type, table_name, record_id,
    old_values, new_values, metadata
  ) VALUES (
    auth.uid(),
    v_action,
    'user_roles',
    v_target,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
    jsonb_build_object(
      'target_user_id', v_target,
      'role', COALESCE(NEW.role::text, OLD.role::text)
    )
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---- Attach triggers ---------------------------------------
-- Reports
DROP TRIGGER IF EXISTS trg_audit_inspections ON public.inspections;
CREATE TRIGGER trg_audit_inspections
  AFTER INSERT OR UPDATE OR DELETE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

DROP TRIGGER IF EXISTS trg_audit_trainings ON public.trainings;
CREATE TRIGGER trg_audit_trainings
  AFTER INSERT OR UPDATE OR DELETE ON public.trainings
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

DROP TRIGGER IF EXISTS trg_audit_daily_assessments ON public.daily_assessments;
CREATE TRIGGER trg_audit_daily_assessments
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_assessments
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

-- Profiles (admin-driven changes to user info)
DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
  AFTER UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

-- User roles (privilege changes)
DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_role_change();

-- Admin edit snapshots (admin-edited-other-user reports)
DROP TRIGGER IF EXISTS trg_audit_admin_snapshots ON public.admin_edit_snapshots;
CREATE TRIGGER trg_audit_admin_snapshots
  AFTER INSERT ON public.admin_edit_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_table_change();

-- ---- RPC for resolving user names in viewer ----------------
CREATE OR REPLACE FUNCTION public.audit_resolve_users(_user_ids uuid[])
RETURNS TABLE(id uuid, first_name text, last_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.first_name, p.last_name
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
    AND public.is_super_admin();
$$;
