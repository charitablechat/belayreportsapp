-- Clean up duplicate triggers, keeping consistently-named versions

-- daily_assessments duplicates
DROP TRIGGER IF EXISTS auto_link_daily_assessment_organization ON public.daily_assessments;
DROP TRIGGER IF EXISTS on_daily_assessment_completed ON public.daily_assessments;
DROP TRIGGER IF EXISTS on_daily_assessment_completed_email ON public.daily_assessments;
DROP TRIGGER IF EXISTS prevent_inspector_id_change_daily_assessments ON public.daily_assessments;
DROP TRIGGER IF EXISTS update_daily_assessments_updated_at ON public.daily_assessments;

-- inspections duplicates
DROP TRIGGER IF EXISTS on_inspection_completed ON public.inspections;
DROP TRIGGER IF EXISTS on_inspection_completed_email ON public.inspections;
DROP TRIGGER IF EXISTS prevent_inspector_id_change_inspections ON public.inspections;
DROP TRIGGER IF EXISTS trigger_auto_link_organization ON public.inspections;
DROP TRIGGER IF EXISTS trigger_inspection_completed ON public.inspections;
DROP TRIGGER IF EXISTS trigger_notify_inspection_completed ON public.inspections;
DROP TRIGGER IF EXISTS update_inspections_updated_at ON public.inspections;

-- trainings duplicates
DROP TRIGGER IF EXISTS auto_link_training_organization ON public.trainings;
DROP TRIGGER IF EXISTS on_training_completed ON public.trainings;
DROP TRIGGER IF EXISTS on_training_completed_email ON public.trainings;
DROP TRIGGER IF EXISTS prevent_inspector_id_change_trainings ON public.trainings;
DROP TRIGGER IF EXISTS update_trainings_updated_at ON public.trainings;

-- sync_conflicts duplicates (keep trigger_sync_conflict_notification)
DROP TRIGGER IF EXISTS trigger_notify_sync_conflict ON public.sync_conflicts;
DROP TRIGGER IF EXISTS trigger_sync_conflict ON public.sync_conflicts;

-- profiles duplicate (keep on_profile_updated for updated_at, keep add_name_to_history_trigger)
DROP TRIGGER IF EXISTS on_profile_name_updated ON public.profiles;