-- Create audit logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL, -- 'inspection_completed', 'role_changed', 'notification_sent', etc.
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Super admins can view all audit logs"
ON public.audit_logs
FOR SELECT
USING (is_super_admin());

CREATE POLICY "Users can view their own audit logs"
ON public.audit_logs
FOR SELECT
USING (user_id = auth.uid());

-- Create index for better query performance
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);

-- Function to create audit log entries
CREATE OR REPLACE FUNCTION public.create_audit_log(
  p_user_id UUID,
  p_action_type TEXT,
  p_table_name TEXT,
  p_record_id UUID,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  INSERT INTO public.audit_logs (
    user_id,
    action_type,
    table_name,
    record_id,
    old_values,
    new_values,
    metadata
  ) VALUES (
    p_user_id,
    p_action_type,
    p_table_name,
    p_record_id,
    p_old_values,
    p_new_values,
    p_metadata
  )
  RETURNING id INTO v_audit_id;
  
  RETURN v_audit_id;
END;
$$;

-- Trigger function for inspection completions
CREATE OR REPLACE FUNCTION public.audit_inspection_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    PERFORM create_audit_log(
      NEW.inspector_id,
      'inspection_completed',
      'inspections',
      NEW.id,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      jsonb_build_object(
        'location', NEW.location,
        'organization', NEW.organization,
        'inspection_date', NEW.inspection_date
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger for inspection completions
CREATE TRIGGER audit_inspection_completion_trigger
AFTER UPDATE ON public.inspections
FOR EACH ROW
EXECUTE FUNCTION public.audit_inspection_completion();

-- Trigger function for user role changes
CREATE OR REPLACE FUNCTION public.audit_user_role_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action_type TEXT;
  v_old_values JSONB;
  v_new_values JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action_type := 'role_added';
    v_old_values := NULL;
    v_new_values := jsonb_build_object('role', NEW.role, 'organization_id', NEW.organization_id);
    
    PERFORM create_audit_log(
      NEW.user_id,
      v_action_type,
      'user_roles',
      NEW.id,
      v_old_values,
      v_new_values,
      jsonb_build_object('affected_user_id', NEW.user_id)
    );
    
  ELSIF TG_OP = 'UPDATE' THEN
    v_action_type := 'role_changed';
    v_old_values := jsonb_build_object('role', OLD.role, 'organization_id', OLD.organization_id);
    v_new_values := jsonb_build_object('role', NEW.role, 'organization_id', NEW.organization_id);
    
    PERFORM create_audit_log(
      NEW.user_id,
      v_action_type,
      'user_roles',
      NEW.id,
      v_old_values,
      v_new_values,
      jsonb_build_object('affected_user_id', NEW.user_id)
    );
    
  ELSIF TG_OP = 'DELETE' THEN
    v_action_type := 'role_removed';
    v_old_values := jsonb_build_object('role', OLD.role, 'organization_id', OLD.organization_id);
    v_new_values := NULL;
    
    PERFORM create_audit_log(
      OLD.user_id,
      v_action_type,
      'user_roles',
      OLD.id,
      v_old_values,
      v_new_values,
      jsonb_build_object('affected_user_id', OLD.user_id)
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger for user role changes
CREATE TRIGGER audit_user_role_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.audit_user_role_changes();

-- Trigger function for notification sends
CREATE OR REPLACE FUNCTION public.audit_notification_send()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM create_audit_log(
    NEW.user_id,
    'notification_sent',
    'notifications_log',
    NEW.id,
    NULL,
    jsonb_build_object(
      'notification_type', NEW.notification_type,
      'title', NEW.title,
      'status', NEW.status
    ),
    NEW.data
  );
  
  RETURN NEW;
END;
$$;

-- Trigger for notification sends
CREATE TRIGGER audit_notification_send_trigger
AFTER INSERT ON public.notifications_log
FOR EACH ROW
EXECUTE FUNCTION public.audit_notification_send();