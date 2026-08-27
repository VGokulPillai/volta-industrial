-- ============================================================================
-- Volta Industrial — Silver→Gold build (Databricks SQL)
-- Reads the raw parquet in the raw_data Volume and materializes the tables the
-- dashboard / Genie / app consume. Statements are separated by a marker line
-- (see run_sql.py) so the runner can post each one to the SQL Statements API.
-- Placeholders CATALOG / SCHEMA are substituted by the runner.
-- Volume base: /Volumes/${CATALOG}/${SCHEMA}/raw_data/<dataset>
-- ============================================================================

-- raw_parts (materialized with app-facing derived columns) --------------------
CREATE OR REPLACE TABLE ${CATALOG}.${SCHEMA}.raw_parts AS
SELECT
    part_id                    AS id,
    part_id,
    part_name,
    part_type                  AS part_category,
    machine_type,
    description,
    (local_stock_qty > 0)      AS part_local,
    lead_time_days,
    unit_cost_usd
FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/parts', format => 'parquet');

-- @@STATEMENT@@

-- gold_line_status (the coherence spine) -------------------------------------
CREATE OR REPLACE TABLE ${CATALOG}.${SCHEMA}.gold_line_status AS
WITH tel AS (
    SELECT line_id, vibration_rms, temperature_c, utilization_pct,
           ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY telemetry_date DESC) AS rn
    FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/telemetry', format => 'parquet')
),
tel_latest AS (SELECT * FROM tel WHERE rn = 1),
risk AS (
    SELECT line_id, failure_risk_score, open_wo_count, technician_note_text, snapshot_date,
           ROW_NUMBER() OVER (PARTITION BY line_id ORDER BY snapshot_date DESC) AS rn
    FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/risk_snapshots', format => 'parquet')
),
risk_latest AS (SELECT * FROM risk WHERE rn = 1),
wo AS (
    SELECT line_id,
           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_wo_count,
           MAX(CASE WHEN status = 'open' AND wo_type = 'corrective' THEN true ELSE false END) AS has_open_corrective,
           MAX(CASE WHEN status = 'open' AND wo_type = 'corrective' THEN part_id END) AS candidate_part_id
    FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/work_orders', format => 'parquet')
    GROUP BY line_id
),
lines AS (
    SELECT line_id, plant_id, line_name, machine_type, criticality, plant_lat, plant_lng
    FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/lines', format => 'parquet')
),
parts AS (
    SELECT part_id, (local_stock_qty > 0) AS part_local, lead_time_days, unit_cost_usd
    FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/parts', format => 'parquet')
)
SELECT
    concat(l.line_id, ':', l.plant_id)                                   AS id,
    l.line_id, l.plant_id, l.line_name, l.machine_type, l.criticality,
    l.plant_lat, l.plant_lng,
    CASE l.plant_id
        WHEN 'PLANT-01' THEN 'Detroit'    WHEN 'PLANT-02' THEN 'Pittsburgh'
        WHEN 'PLANT-03' THEN 'Columbus'   WHEN 'PLANT-04' THEN 'Milwaukee'
        WHEN 'PLANT-05' THEN 'Charlotte'  WHEN 'PLANT-06' THEN 'Dallas'
        WHEN 'PLANT-07' THEN 'Phoenix'    WHEN 'PLANT-08' THEN 'Portland'
    END                                                                  AS plant_name,
    CASE l.plant_id
        WHEN 'PLANT-01' THEN 'Midwest'    WHEN 'PLANT-02' THEN 'Northeast'
        WHEN 'PLANT-03' THEN 'Midwest'    WHEN 'PLANT-04' THEN 'Midwest'
        WHEN 'PLANT-05' THEN 'Southeast'  WHEN 'PLANT-06' THEN 'South'
        WHEN 'PLANT-07' THEN 'West'       WHEN 'PLANT-08' THEN 'West'
    END                                                                  AS region,
    coalesce(t.vibration_rms, 0)                                         AS vibration_rms,
    coalesce(t.temperature_c, 0)                                         AS temperature_c,
    coalesce(t.utilization_pct, 0)                                       AS utilization_pct,
    coalesce(r.failure_risk_score, 0)                                    AS failure_risk_score,
    coalesce(w.open_wo_count, 0)                                         AS open_wo_count,
    coalesce(w.has_open_corrective, false)                               AS has_open_corrective,
    coalesce(p.part_local, true)                                         AS part_local,
    w.candidate_part_id,
    p.lead_time_days                                                     AS part_lead_time_days,
    p.unit_cost_usd                                                      AS part_unit_cost_usd,
    CASE
        WHEN r.technician_note_text IS NULL THEN 0.1
        WHEN lower(r.technician_note_text) LIKE '%no faults%'
          OR lower(r.technician_note_text) LIKE '%pm completed%'
          OR lower(r.technician_note_text) LIKE '%running to plan%' THEN 0.1
        WHEN lower(r.technician_note_text) LIKE '%vibration%'
          OR lower(r.technician_note_text) LIKE '%temperature%'
          OR lower(r.technician_note_text) LIKE '%intermittent%'
          OR lower(r.technician_note_text) LIKE '%noise%'
          OR lower(r.technician_note_text) LIKE '%local stock%'
          OR lower(r.technician_note_text) LIKE '%backlog%' THEN 1.0
        ELSE 0.6
    END                                                                  AS risk_signal_score,
    CASE WHEN coalesce(r.failure_risk_score, 0) >= 0.6
         THEN round(r.failure_risk_score * 2 * 22000, 2) ELSE 0 END      AS downtime_exposure_usd,
    CASE
        WHEN coalesce(r.failure_risk_score, 0) >= 0.75 AND coalesce(w.has_open_corrective, false) THEN 'critical'
        WHEN coalesce(r.failure_risk_score, 0) >= 0.6  THEN 'elevated'
        WHEN coalesce(r.failure_risk_score, 0) >= 0.4  THEN 'watch'
        ELSE 'healthy'
    END                                                                  AS risk_band,
    CASE
        WHEN coalesce(r.failure_risk_score, 0) >= 0.75 AND coalesce(w.has_open_corrective, false) THEN 'critical'
        WHEN coalesce(r.failure_risk_score, 0) >= 0.4  THEN 'at_risk'
        ELSE 'healthy'
    END                                                                  AS current_status,
    CAST(r.snapshot_date AS TIMESTAMP)                                   AS last_check_at
FROM lines l
LEFT JOIN tel_latest  t ON t.line_id = l.line_id
LEFT JOIN risk_latest r ON r.line_id = l.line_id
LEFT JOIN wo          w ON w.line_id = l.line_id
LEFT JOIN parts       p ON p.part_id = w.candidate_part_id;

-- @@STATEMENT@@

-- gold_open_atrisk -----------------------------------------------------------
CREATE OR REPLACE TABLE ${CATALOG}.${SCHEMA}.gold_open_atrisk AS
SELECT
    line_id, plant_id, line_name, failure_risk_score, downtime_exposure_usd,
    open_wo_count, part_local, candidate_part_id, part_lead_time_days,
    part_unit_cost_usd, criticality
FROM ${CATALOG}.${SCHEMA}.gold_line_status
WHERE risk_band IN ('critical', 'elevated', 'watch');

-- @@STATEMENT@@

-- gold_maintenance_outcomes (model training / heuristic source) --------------
CREATE OR REPLACE TABLE ${CATALOG}.${SCHEMA}.gold_maintenance_outcomes AS
SELECT
    event_id, line_id, action_type, risk_at_action, part_local,
    action_cost_usd, downtime_hours, avoided_unplanned_stop, downtime_cost_avoided_usd
FROM read_files('/Volumes/${CATALOG}/${SCHEMA}/raw_data/maintenance_events', format => 'parquet');

-- @@STATEMENT@@

-- gold_maintenance_recommendations (pipeline heuristic; pull_now wins for hero)
CREATE OR REPLACE TABLE ${CATALOG}.${SCHEMA}.gold_maintenance_recommendations AS
WITH base AS (
    SELECT
        line_id,
        failure_risk_score,
        part_local,
        candidate_part_id,
        part_lead_time_days,
        coalesce(part_unit_cost_usd, 0)                      AS unit_cost,
        (4 * 22000)                                          AS stop
    FROM ${CATALOG}.${SCHEMA}.gold_open_atrisk
),
calc AS (
    SELECT
        *,
        round(failure_risk_score * stop, 2)                                       AS pull_avoided,
        40000.0                                                                   AS pull_cost,
        8000.0                                                                    AS run_avoided,
        round(failure_risk_score * stop * (CASE WHEN part_local THEN 0.6 ELSE 1.0 END), 2) AS run_cost,
        round(failure_risk_score * stop * (CASE WHEN part_local THEN 0.6 ELSE 0.3 END), 2) AS exp_avoided,
        round(CASE WHEN part_local THEN unit_cost * 2 + 400
                   ELSE unit_cost * 3 + coalesce(part_lead_time_days, 0) * stop END, 2)     AS exp_cost
    FROM base
),
nets AS (
    SELECT *,
        round(pull_avoided - pull_cost, 2) AS pull_net,
        round(run_avoided  - run_cost,  2) AS run_net,
        round(exp_avoided  - exp_cost,  2) AS exp_net
    FROM calc
)
SELECT
    line_id,
    CASE
        WHEN pull_net >= run_net AND pull_net >= exp_net THEN 'pull_now'
        WHEN exp_net  >= run_net AND exp_net  >= pull_net THEN 'expedite_parts_and_run'
        ELSE 'run_to_shift_end'
    END AS recommended_action,
    CASE
        WHEN pull_net >= run_net AND pull_net >= exp_net THEN pull_avoided
        WHEN exp_net  >= run_net AND exp_net  >= pull_net THEN exp_avoided
        ELSE run_avoided
    END AS predicted_downtime_cost_usd,
    greatest(pull_net, run_net, exp_net) AS predicted_net_value_usd,
    to_json(array(
        named_struct('action','pull_now',
            'predictedDowntimeCostAvoidsUsd', pull_avoided,
            'estimatedNetValueUsd', pull_net,
            'partId', CAST(NULL AS STRING),
            'estimatedLeadTimeDays', CAST(NULL AS INT)),
        named_struct('action','run_to_shift_end',
            'predictedDowntimeCostAvoidsUsd', run_avoided,
            'estimatedNetValueUsd', run_net,
            'partId', CAST(NULL AS STRING),
            'estimatedLeadTimeDays', CAST(NULL AS INT)),
        named_struct('action','expedite_parts_and_run',
            'predictedDowntimeCostAvoidsUsd', exp_avoided,
            'estimatedNetValueUsd', exp_net,
            'partId', candidate_part_id,
            'estimatedLeadTimeDays', part_lead_time_days)
    )) AS action_ranking,
    current_timestamp() AS scored_at
FROM nets;

-- @@STATEMENT@@

-- Validation snapshot (returned to the runner) -------------------------------
SELECT 'hero' AS check, line_id, plant_id, failure_risk_score, risk_band, has_open_corrective, part_local, downtime_exposure_usd
FROM ${CATALOG}.${SCHEMA}.gold_line_status
WHERE line_id = 'LINE-0004' AND plant_id = 'PLANT-03';
