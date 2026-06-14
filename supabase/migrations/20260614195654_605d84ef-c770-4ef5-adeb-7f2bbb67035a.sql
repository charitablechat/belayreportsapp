ALTER TABLE public.jcf_reports
  ADD CONSTRAINT jcf_reports_inspector_id_profiles_fkey
  FOREIGN KEY (inspector_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';