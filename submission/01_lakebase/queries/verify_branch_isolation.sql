-- ============================================================================
-- Verify branch isolation — Lakebase Postgres
-- ============================================================================
-- Run the SAME query text against two branch connections and compare:
--   (A) dev/maintenance-agent branch  → change IS present
--   (B) production branch             → change is ABSENT
--
-- Connect to a specific branch by pointing PGHOST/PGDATABASE (or the Lakebase
-- endpoint) at that branch's endpoint, then run the block below. Do not rely on
-- one connection to "see" another branch — that is the whole point of isolation.
-- ============================================================================

-- ── 1. Does the maintenance_actions table exist on THIS branch? ──────────────
SELECT
    to_regclass('app.maintenance_actions') IS NOT NULL AS maintenance_actions_exists;
-- Expected on dev/maintenance-agent : true
-- Expected on production            : false

-- ── 2. Do the branch-only enrichment columns exist on THIS branch? ───────────
SELECT
    column_name
FROM information_schema.columns
WHERE table_schema = 'app'
  AND table_name   = 'maintenance_actions'
  AND column_name IN ('expected_downtime_avoided_hours','estimated_net_value_usd')
ORDER BY column_name;
-- Expected on dev/maintenance-agent : two rows
-- Expected on production            : zero rows (table does not exist)

-- ── 3. Branch-only test decisions for LINE-04 present on THIS branch? ─────────
-- NOTE: this SELECT errors on production if the table is absent — that error is
-- itself proof of isolation. Guarded version:
SELECT COALESCE(
    (SELECT count(*) FROM app.maintenance_actions WHERE line_id = 'LINE-04'),
    0
) AS line04_action_rows
WHERE to_regclass('app.maintenance_actions') IS NOT NULL;
-- Expected on dev/maintenance-agent : 3
-- Expected on production            : (no rows returned; table absent)

-- ── 4. Production baseline is intact on BOTH branches (inherited state) ───────
SELECT count(*) AS production_lines_count FROM app.production_lines;
SELECT failure_risk_score, risk_band
FROM app.machine_state WHERE line_id = 'LINE-04';
-- Expected on BOTH branches: production_lines_count = 8; LINE-04 risk 0.87 / critical
-- (the developer branch inherited full production state, and production is
--  unchanged by the branch experiment.)
