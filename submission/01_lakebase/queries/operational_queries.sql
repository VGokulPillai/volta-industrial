-- ============================================================================
-- Core operational queries — Lakebase Postgres
-- The low-latency reads the Databricks App issues on the plant-floor surface.
-- These must keep working before AND after migration 002 (see validate_migration.sql).
-- ============================================================================

-- ── At-risk lines, worst first (drives the Plant Floor table + KPIs) ─────────
SELECT
    pl.line_id,
    pl.plant_id,
    pl.line_name,
    pl.machine_type,
    ms.failure_risk_score,
    ms.risk_band,
    ms.vibration_rms,
    ms.temperature_c,
    ms.utilization_pct,
    wo.status         AS open_work_order_status,
    p.part_local      AS required_part_local,
    p.lead_time_days  AS required_part_lead_days
FROM app.production_lines pl
JOIN app.machine_state ms       ON ms.line_id = pl.line_id
LEFT JOIN app.work_orders wo    ON wo.line_id = pl.line_id AND wo.status = 'open'
LEFT JOIN app.parts_inventory p ON p.part_id = wo.required_part_id
ORDER BY ms.failure_risk_score DESC;

-- ── Plant-floor KPIs ─────────────────────────────────────────────────────────
SELECT
    count(*) FILTER (WHERE ms.risk_band = 'critical')                       AS critical_lines,
    count(*) FILTER (WHERE ms.risk_band IN ('critical','elevated','watch')) AS lines_at_risk,
    (SELECT count(*) FROM app.work_orders WHERE status = 'open')            AS open_corrective_work_orders,
    -- Downtime exposure = risk * expected stop hours * $/hr, summed over the fleet.
    round(sum(ms.failure_risk_score * 4.0 * 22000.0)::numeric, 0)           AS downtime_exposure_usd
FROM app.machine_state ms;

-- ── Hero line detail (LINE-04) ───────────────────────────────────────────────
SELECT
    pl.line_id, pl.plant_id, pl.line_name, pl.machine_type, pl.criticality, pl.status,
    ms.failure_risk_score, ms.risk_band, ms.vibration_rms, ms.temperature_c, ms.utilization_pct,
    wo.work_order_id, wo.status AS wo_status, wo.description AS wo_description,
    p.part_id, p.part_name, p.part_local, p.quantity_available, p.lead_time_days, p.unit_cost_usd
FROM app.production_lines pl
JOIN app.machine_state ms       ON ms.line_id = pl.line_id
LEFT JOIN app.work_orders wo    ON wo.line_id = pl.line_id AND wo.status = 'open'
LEFT JOIN app.parts_inventory p ON p.part_id = wo.required_part_id
WHERE pl.line_id = 'LINE-04';

-- ── At-risk lines that ALSO have a parts shortage (non-local part) ───────────
SELECT pl.line_id, pl.plant_id, ms.failure_risk_score, p.part_id, p.part_local, p.lead_time_days
FROM app.production_lines pl
JOIN app.machine_state ms       ON ms.line_id = pl.line_id
JOIN app.work_orders wo         ON wo.line_id = pl.line_id AND wo.status = 'open'
JOIN app.parts_inventory p      ON p.part_id = wo.required_part_id
WHERE ms.failure_risk_score >= 0.5 AND p.part_local = false
ORDER BY ms.failure_risk_score DESC;
