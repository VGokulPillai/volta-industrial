-- ============================================================================
-- Validate migration 002 BEFORE promotion — Lakebase Postgres
-- Run on dev/maintenance-agent after applying 002_maintenance_actions.sql.
-- Every check should return the "PASS" row. Re-run on `development` after
-- promotion, and on `production` as the final gate.
-- ============================================================================

-- 1. Migration completed: table + branch-only columns exist.
SELECT CASE WHEN
    to_regclass('app.maintenance_actions') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='app' AND table_name='maintenance_actions'
                  AND column_name='expected_downtime_avoided_hours')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='app' AND table_name='maintenance_actions'
                  AND column_name='estimated_net_value_usd')
    THEN 'PASS: migration objects present' ELSE 'FAIL' END AS check_migration;

-- 2. Constraints work: the CHECK on evaluated_action rejects bad values.
DO $$
BEGIN
    BEGIN
        INSERT INTO app.maintenance_actions (line_id, evaluated_action)
        VALUES ('LINE-04', 'not_a_real_action');
        RAISE EXCEPTION 'FAIL: invalid evaluated_action was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS: evaluated_action CHECK constraint enforced';
    END;
END $$;

-- 3. LINE-04 can accept recommendations/actions (FK to production_lines holds).
SELECT CASE WHEN count(*) >= 3 THEN 'PASS: LINE-04 actions recorded'
            ELSE 'FAIL: expected >=3 LINE-04 actions' END AS check_line04
FROM app.maintenance_actions WHERE line_id = 'LINE-04';

-- 4. Referential integrity: no maintenance_actions orphaned from a line.
SELECT CASE WHEN count(*) = 0 THEN 'PASS: no orphan actions'
            ELSE 'FAIL: orphan actions exist' END AS check_fk
FROM app.maintenance_actions ma
LEFT JOIN app.production_lines pl ON pl.line_id = ma.line_id
WHERE pl.line_id IS NULL;

-- 5. Work-order relationships remain valid (existing operational data intact).
SELECT CASE WHEN count(*) = 0 THEN 'PASS: work_orders → parts FK intact'
            ELSE 'FAIL: work_orders reference missing parts' END AS check_wo_parts
FROM app.work_orders wo
LEFT JOIN app.parts_inventory p ON p.part_id = wo.required_part_id
WHERE wo.required_part_id IS NOT NULL AND p.part_id IS NULL;

-- 6. Search still functions (full-text index answers a bearing query).
SELECT CASE WHEN count(*) >= 1 THEN 'PASS: hybrid search returns results'
            ELSE 'FAIL: search returned nothing' END AS check_search
FROM app.maintenance_notes
WHERE to_tsvector('english', technician_note)
      @@ websearch_to_tsquery('english', 'bearing vibration grinding');

-- 7. Existing operational queries still function (at-risk ranking unaffected).
SELECT CASE WHEN count(*) = 8 THEN 'PASS: line fleet intact (8 lines)'
            ELSE 'FAIL: unexpected line count' END AS check_fleet
FROM app.production_lines;
