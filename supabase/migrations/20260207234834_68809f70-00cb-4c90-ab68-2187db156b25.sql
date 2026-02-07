-- Fix profiles: change INSERT/UPDATE policies from public to authenticated
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Fix notifications_log: rename misleading policy and add INSERT policy
DROP POLICY IF EXISTS "Super admins can view their notifications" ON public.notifications_log;
CREATE POLICY "Users can view their own notifications"
  ON public.notifications_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Restrict inserts to service_role only (edge functions insert notifications)
-- No INSERT policy for authenticated = users can't insert fake notifications