-- ============================================================================
-- Volta Industrial — Lakebase (PostgreSQL) operational data model
-- Migration 001: base operational schema + realistic seed
-- Engine: Lakebase Postgres (PostgreSQL dialect). DO NOT run on Databricks SQL.
-- ============================================================================
--
-- This is the operational (OLTP) state that the Databricks App reads/writes at
-- low latency. It mirrors the shape the app uses (schema `app`) plus the richer
-- operational entities the Lakebase build requires (plants, production_lines,
-- machine_state, parts_inventory, work_orders, maintenance_notes).
--
-- Run on the PRODUCTION branch first (this is the production baseline). The
-- development + dev/maintenance-agent branches inherit this state instantly via
-- Lakebase branching (see agent_workflow/BRANCHING_WORKFLOW.md).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- ── plants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.plants (
    plant_id     TEXT PRIMARY KEY,
    plant_name   TEXT NOT NULL,
    region       TEXT,
    state_code   TEXT,
    lat          DOUBLE PRECISION,
    lng          DOUBLE PRECISION,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── production_lines ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.production_lines (
    line_id      TEXT PRIMARY KEY,
    plant_id     TEXT NOT NULL REFERENCES app.plants(plant_id),
    line_name    TEXT NOT NULL,
    machine_type TEXT NOT NULL,
    criticality  TEXT NOT NULL DEFAULT 'medium'
                 CHECK (criticality IN ('low','medium','high')),
    status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','maintenance_scheduled','stopped')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_lines_plant_idx ON app.production_lines(plant_id);

-- ── machine_state (live telemetry snapshot per line) ─────────────────────────
CREATE TABLE IF NOT EXISTS app.machine_state (
    line_id            TEXT PRIMARY KEY REFERENCES app.production_lines(line_id),
    failure_risk_score DOUBLE PRECISION NOT NULL DEFAULT 0.0
                       CHECK (failure_risk_score >= 0 AND failure_risk_score <= 1),
    vibration_rms      DOUBLE PRECISION,
    temperature_c      DOUBLE PRECISION,
    utilization_pct    DOUBLE PRECISION,
    risk_band          TEXT NOT NULL DEFAULT 'healthy'
                       CHECK (risk_band IN ('healthy','watch','elevated','critical')),
    last_telemetry_at  TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS machine_state_risk_idx ON app.machine_state(failure_risk_score DESC);
CREATE INDEX IF NOT EXISTS machine_state_band_idx ON app.machine_state(risk_band);

-- ── parts_inventory ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.parts_inventory (
    part_id            TEXT PRIMARY KEY,
    part_name          TEXT NOT NULL,
    plant_id           TEXT REFERENCES app.plants(plant_id),
    machine_type       TEXT,
    description        TEXT,
    quantity_available INTEGER NOT NULL DEFAULT 0,
    part_local         BOOLEAN NOT NULL DEFAULT true,
    lead_time_days     INTEGER,
    unit_cost_usd      NUMERIC(12,2),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_inventory_plant_idx ON app.parts_inventory(plant_id);
CREATE INDEX IF NOT EXISTS parts_inventory_local_idx ON app.parts_inventory(part_local);

-- ── work_orders ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app.work_orders (
    work_order_id    TEXT PRIMARY KEY,
    line_id          TEXT NOT NULL REFERENCES app.production_lines(line_id),
    status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','approved','in_progress','closed','rejected')),
    action_type      TEXT
                     CHECK (action_type IN ('pull_now','run_to_shift_end','expedite_parts_and_run','corrective','preventive')),
    description      TEXT,
    required_part_id TEXT REFERENCES app.parts_inventory(part_id),
    created_by       TEXT,
    approved_by      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_orders_line_idx ON app.work_orders(line_id, status);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON app.work_orders(status);

-- ── maintenance_notes (target of hybrid search) ──────────────────────────────
CREATE TABLE IF NOT EXISTS app.maintenance_notes (
    note_id         TEXT PRIMARY KEY,
    line_id         TEXT NOT NULL REFERENCES app.production_lines(line_id),
    technician_note TEXT NOT NULL,
    machine_type    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_notes_line_idx ON app.maintenance_notes(line_id);

-- ============================================================================
-- Realistic seed — healthy / watch / elevated / critical variation across the
-- 8-plant fleet, with LINE-04 @ PLANT-03 as the hero critical scenario.
-- ============================================================================

INSERT INTO app.plants (plant_id, plant_name, region, state_code, lat, lng) VALUES
    ('PLANT-01','Detroit','Midwest','MI',42.33,-83.05),
    ('PLANT-02','Pittsburgh','Northeast','PA',40.44,-79.996),
    ('PLANT-03','Columbus','Midwest','OH',39.96,-82.99),
    ('PLANT-04','Milwaukee','Midwest','WI',43.04,-87.91),
    ('PLANT-05','Charlotte','Southeast','NC',35.23,-80.84),
    ('PLANT-06','Dallas','South','TX',32.78,-96.80),
    ('PLANT-07','Phoenix','West','AZ',33.45,-112.07),
    ('PLANT-08','Portland','West','OR',45.52,-122.68)
ON CONFLICT (plant_id) DO NOTHING;

INSERT INTO app.production_lines (line_id, plant_id, line_name, machine_type, criticality, status) VALUES
    ('LINE-04','PLANT-03','Line 04 — High-Speed CNC Mill','CNC_Mill','high','running'),        -- HERO
    ('LINE-11','PLANT-03','Line 11 — Hydraulic Press','Hydraulic_Press','high','running'),
    ('LINE-27','PLANT-01','Line 27 — Welding Cell','Welding_Cell','medium','running'),
    ('LINE-43','PLANT-05','Line 43 — Assembly Robot','Assembly_Robot','medium','running'),
    ('LINE-58','PLANT-02','Line 58 — Injection Molder','Injection_Molder','low','running'),
    ('LINE-66','PLANT-06','Line 66 — Grinder','Grinder','medium','running'),
    ('LINE-72','PLANT-04','Line 72 — CNC Mill','CNC_Mill','low','running'),
    ('LINE-89','PLANT-07','Line 89 — Welding Cell','Welding_Cell','low','running')
ON CONFLICT (line_id) DO NOTHING;

INSERT INTO app.machine_state (line_id, failure_risk_score, vibration_rms, temperature_c, utilization_pct, risk_band, last_telemetry_at) VALUES
    ('LINE-04',0.87,5.9,84.2,92.0,'critical', now() - interval '15 minutes'),  -- HERO
    ('LINE-11',0.61,4.2,71.5,88.0,'elevated', now() - interval '20 minutes'),
    ('LINE-27',0.44,3.1,63.0,79.0,'watch',    now() - interval '12 minutes'),
    ('LINE-43',0.38,2.8,61.4,74.0,'watch',    now() - interval '18 minutes'),
    ('LINE-58',0.12,1.9,54.0,66.0,'healthy',  now() - interval '10 minutes'),
    ('LINE-66',0.55,3.8,68.9,81.0,'elevated', now() - interval '22 minutes'),
    ('LINE-72',0.08,1.7,52.3,60.0,'healthy',  now() - interval '9 minutes'),
    ('LINE-89',0.15,2.0,55.1,63.0,'healthy',  now() - interval '14 minutes')
ON CONFLICT (line_id) DO NOTHING;

INSERT INTO app.parts_inventory (part_id, part_name, plant_id, machine_type, description, quantity_available, part_local, lead_time_days, unit_cost_usd) VALUES
    ('SEAL-040-VOLT','Coupling Seal Assembly','PLANT-03','CNC_Mill',
        'Drive-side coupling seal assembly for high-speed CNC spindles. Prevents lubricant loss and bearing contamination. Not stocked locally; must be expedited from the regional depot.',
        0, false, 14, 1250.00),                                          -- HERO part (non-local)
    ('BRG-221-VOLT','Bearing Race Kit','PLANT-03','CNC_Mill',
        'Precision spindle bearing race kit. Addresses drive-side bearing vibration and grinding at high load. In local stock.',
        6, true, 2, 480.00),
    ('HYD-118-VOLT','Hydraulic Seal Set','PLANT-03','Hydraulic_Press',
        'Hydraulic ram seal set for press cylinders. In local stock.',
        4, true, 3, 320.00),
    ('SRV-560-VOLT','Servo Motor','PLANT-01','Welding_Cell',
        'Replacement servo motor for welding-cell positioner. In local stock.',
        2, true, 5, 2100.00),
    ('BLT-090-VOLT','Drive Belt','PLANT-06','Grinder',
        'Grinder drive belt, standard duty. In local stock.',
        12, true, 1, 90.00)
ON CONFLICT (part_id) DO NOTHING;

INSERT INTO app.work_orders (work_order_id, line_id, status, action_type, description, required_part_id, created_by) VALUES
    ('WO-10004','LINE-04','open','corrective',
        'Open corrective: drive-side bearing vibration + rising temperature on high-speed CNC spindle. Replacement coupling seal not stocked locally.',
        'SEAL-040-VOLT','system'),
    ('WO-10011','LINE-11','open','corrective',
        'Open corrective: hydraulic press ram seal weep detected during last inspection.',
        'HYD-118-VOLT','system'),
    ('WO-10066','LINE-66','open','corrective',
        'Open corrective: grinder drive belt wear approaching threshold.',
        'BLT-090-VOLT','system')
ON CONFLICT (work_order_id) DO NOTHING;

INSERT INTO app.maintenance_notes (note_id, line_id, technician_note, machine_type) VALUES
    ('NOTE-0001','LINE-04',
        'Drive-side bearing vibration increased during the last two shifts. Grinding noise observed at high load. Recommend inspecting coupling seal and spindle bearing race.',
        'CNC_Mill'),
    ('NOTE-0002','LINE-11',
        'Hydraulic ram seal showing minor weep. Pressure holds within tolerance but trending down. Schedule seal replacement.',
        'Hydraulic_Press'),
    ('NOTE-0003','LINE-27',
        'Welding-cell positioner intermittent fault cleared after reseating connector. Monitoring for recurrence.',
        'Welding_Cell'),
    ('NOTE-0004','LINE-66',
        'Grinder emitting high-frequency vibration under load; belt tension re-checked. Bearing noise faint but present.',
        'Grinder'),
    ('NOTE-0005','LINE-04',
        'Prior shift logged elevated spindle temperature and audible bearing whine. Coupling seal suspected. Part not on hand locally.',
        'CNC_Mill'),
    ('NOTE-0006','LINE-58',
        'Injection molder running to plan. Preventive maintenance completed on schedule. No faults.',
        'Injection_Molder'),
    ('NOTE-0007','LINE-43',
        'Assembly robot axis-3 servo drew slightly elevated current briefly; cleared. No further anomalies.',
        'Assembly_Robot')
ON CONFLICT (note_id) DO NOTHING;
