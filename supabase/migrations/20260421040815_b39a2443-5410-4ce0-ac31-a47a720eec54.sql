-- ============================================================
-- Child-row mass-delete guard
-- Blocks any single DELETE statement that wipes >70% of a
-- parent's children, unless the session has explicitly opted in.
-- ============================================================

-- 1. Opt-in helper (SECURITY DEFINER, callable by authenticated users).
--    Sets a transaction-local GUC that the trigger checks.
CREATE OR REPLACE FUNCTION public.set_bulk_delete_opt_in()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Transaction-local; auto-cleared at COMMIT/ROLLBACK
  PERFORM set_config('app.bulk_delete_opt_in', 'true', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_bulk_delete_opt_in() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_bulk_delete_opt_in() TO authenticated, service_role;

-- 2. Generic trigger function. Uses TG_ARGV[0] as the FK column name.
CREATE OR REPLACE FUNCTION public.protect_child_row_mass_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fk_column   text := TG_ARGV[0];
  v_opted_in    text;
  v_offender    record;
BEGIN
  -- Fast path: explicit opt-in by a trusted bulk operation
  v_opted_in := current_setting('app.bulk_delete_opt_in', true);
  IF v_opted_in = 'true' THEN
    RETURN NULL;
  END IF;

  -- For every parent affected by this statement, compare
  -- (rows being deleted) vs (rows that exist on the server).
  -- Block if any single parent loses more than 70% in this stmt.
  FOR v_offender IN EXECUTE format($q$
    WITH del AS (
      SELECT (row_to_json(o.*)->>%L)::uuid AS parent_id, COUNT(*) AS del_count
      FROM old_table o
      WHERE (row_to_json(o.*)->>%L) IS NOT NULL
      GROUP BY 1
    ),
    cur AS (
      SELECT (row_to_json(t.*)->>%L)::uuid AS parent_id, COUNT(*) AS cur_count
      FROM %I t
      WHERE (row_to_json(t.*)->>%L)::uuid IN (SELECT parent_id FROM del)
      GROUP BY 1
    )
    SELECT d.parent_id, d.del_count, COALESCE(c.cur_count, 0) AS cur_count
    FROM del d
    LEFT JOIN cur c USING (parent_id)
    WHERE COALESCE(c.cur_count, 0) >= 3
      AND d.del_count::numeric / COALESCE(c.cur_count, 1)::numeric > 0.70
    LIMIT 1
  $q$, v_fk_column, v_fk_column, v_fk_column, TG_TABLE_NAME, v_fk_column)
  LOOP
    RAISE EXCEPTION
      'child_row_mass_delete_blocked: refusing to delete %/% rows (>70%%) of % for parent %. Call set_bulk_delete_opt_in() first if intentional.',
      v_offender.del_count, v_offender.cur_count, TG_TABLE_NAME, v_offender.parent_id
      USING ERRCODE = 'check_violation';
  END LOOP;

  RETURN NULL;
END;
$$;

-- 3. Attach the trigger to every report child table.
--    AFTER … FOR EACH STATEMENT REFERENCING OLD TABLE gives us the deleted set;
--    raising in AFTER aborts the whole statement (transactional safety preserved).

DO $do$
DECLARE
  rec record;
  table_fk_pairs text[][] := ARRAY[
    -- inspection children
    ARRAY['inspection_systems',                    'inspection_id'],
    ARRAY['inspection_ziplines',                   'inspection_id'],
    ARRAY['inspection_equipment',                  'inspection_id'],
    ARRAY['inspection_standards',                  'inspection_id'],
    ARRAY['inspection_summary',                    'inspection_id'],
    ARRAY['inspection_photos',                     'inspection_id'],
    -- training children
    ARRAY['training_delivery_approaches',          'training_id'],
    ARRAY['training_operating_systems',            'training_id'],
    ARRAY['training_immediate_attention',          'training_id'],
    ARRAY['training_verifiable_items',             'training_id'],
    ARRAY['training_systems_in_place',             'training_id'],
    ARRAY['training_summary',                      'training_id'],
    ARRAY['training_photos',                       'training_id'],
    -- daily assessment children
    ARRAY['daily_assessment_beginning_of_day',     'assessment_id'],
    ARRAY['daily_assessment_end_of_day',           'assessment_id'],
    ARRAY['daily_assessment_operating_systems',    'assessment_id'],
    ARRAY['daily_assessment_equipment_checks',     'assessment_id'],
    ARRAY['daily_assessment_structure_checks',     'assessment_id'],
    ARRAY['daily_assessment_environment_checks',   'assessment_id'],
    ARRAY['daily_assessment_photos',               'assessment_id']
  ];
  i int;
  tbl text;
  fk  text;
BEGIN
  FOR i IN 1 .. array_length(table_fk_pairs, 1) LOOP
    tbl := table_fk_pairs[i][1];
    fk  := table_fk_pairs[i][2];

    -- Only attach if the table actually exists (defensive)
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS protect_mass_delete_%I ON public.%I',
        tbl, tbl
      );
      EXECUTE format($t$
        CREATE TRIGGER protect_mass_delete_%I
        AFTER DELETE ON public.%I
        REFERENCING OLD TABLE AS old_table
        FOR EACH STATEMENT
        EXECUTE FUNCTION public.protect_child_row_mass_delete(%L)
      $t$, tbl, tbl, fk);
    END IF;
  END LOOP;
END
$do$;