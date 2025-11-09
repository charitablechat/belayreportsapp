-- Phase 1: Organizations & User Roles System

-- Create organizations table first (without RLS policy that references organization_members)
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Create role enum
CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'inspector');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, organization_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _org_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role = _role
  )
$$;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Create organization_members junction table
CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organization membership"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- NOW add the RLS policy for organizations that references organization_members
CREATE POLICY "Members can view their organization"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = organizations.id
      AND user_id = auth.uid()
    )
  );

-- Add organization_id to inspections
ALTER TABLE public.inspections 
  ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

CREATE INDEX idx_inspections_organization_id ON public.inspections(organization_id);

-- Phase 2: Push Notification Infrastructure

-- Create push_subscriptions table
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own subscriptions"
  ON public.push_subscriptions FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

-- Create notification_preferences table
CREATE TABLE public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  inspection_completed BOOLEAN DEFAULT true,
  sync_conflicts BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own preferences"
  ON public.notification_preferences FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Create notifications_log table
CREATE TABLE public.notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'
);

ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view their notifications"
  ON public.notifications_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_notifications_log_user_id ON public.notifications_log(user_id);

-- Create sync_conflicts table
CREATE TABLE public.sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID NOT NULL,
  local_updated_at TIMESTAMPTZ NOT NULL,
  remote_updated_at TIMESTAMPTZ NOT NULL,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organization members can view conflicts"
  ON public.sync_conflicts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = sync_conflicts.organization_id
      AND user_id = auth.uid()
    )
  );

-- Phase 3: Triggers & Functions

-- Enable http extension for calling edge functions
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Function to notify super admins on inspection completion
CREATE OR REPLACE FUNCTION notify_super_admins_inspection_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inspector_name TEXT;
  v_org_name TEXT;
BEGIN
  -- Only trigger when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    
    -- Get organization name
    SELECT name INTO v_org_name
    FROM organizations
    WHERE id = NEW.organization_id;
    
    -- Get inspector name (using inspector_id as fallback)
    v_inspector_name := COALESCE(NEW.inspector_name, NEW.inspector_id::TEXT);
    
    -- Call edge function asynchronously via pg_net
    PERFORM net.http_post(
      url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.jwt_secret', true)
      ),
      body := jsonb_build_object(
        'organizationId', NEW.organization_id,
        'notificationType', 'inspection_completed',
        'title', 'Inspection Completed',
        'body', 'Inspector ' || v_inspector_name || ' completed inspection at ' || COALESCE(NEW.location, 'unknown location'),
        'data', jsonb_build_object(
          'inspectionId', NEW.id,
          'organization', v_org_name,
          'location', NEW.location
        )
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_inspection_completed
  AFTER INSERT OR UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION notify_super_admins_inspection_completed();

-- Function to notify super admins on sync conflict
CREATE OR REPLACE FUNCTION notify_super_admins_sync_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Call edge function
  PERFORM net.http_post(
    url := 'https://ssgzcgvygnsrqalisshx.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.jwt_secret', true)
    ),
    body := jsonb_build_object(
      'organizationId', NEW.organization_id,
      'notificationType', 'sync_conflict',
      'title', 'Sync Conflict Detected',
      'body', 'A sync conflict occurred for inspection ' || NEW.inspection_id::TEXT,
      'data', jsonb_build_object(
        'conflictId', NEW.id,
        'inspectionId', NEW.inspection_id
      )
    )
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_sync_conflict_notification
  AFTER INSERT ON public.sync_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION notify_super_admins_sync_conflict();

-- Data migration: Create organizations from existing inspection data
INSERT INTO public.organizations (name)
SELECT DISTINCT organization 
FROM public.inspections 
WHERE organization IS NOT NULL AND organization != ''
ON CONFLICT DO NOTHING;

-- Update inspections with organization_id
UPDATE public.inspections i
SET organization_id = o.id
FROM public.organizations o
WHERE i.organization = o.name;

-- Create default organization members and roles for existing users
INSERT INTO public.organization_members (organization_id, user_id)
SELECT DISTINCT i.organization_id, i.inspector_id
FROM public.inspections i
WHERE i.organization_id IS NOT NULL AND i.inspector_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Assign all existing users as super_admins of their organizations
INSERT INTO public.user_roles (user_id, organization_id, role)
SELECT DISTINCT om.user_id, om.organization_id, 'super_admin'::app_role
FROM public.organization_members om
ON CONFLICT DO NOTHING;