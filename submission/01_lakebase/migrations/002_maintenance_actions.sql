-- ============================================================================
-- Volta Industrial — Lakebase (PostgreSQL)
-- Migration 002: maintenance_actions — the coding-agent branch change
-- Engine: Lakebase Postgres (PostgreSQL dialect).
-- ============================================================================
--
-- This migration is AUTHORED + VALIDATED on the `dev/maintenance-agent` branch
-- by a coding agent (see agent_workflow/AGENT_PROMPT.md). It is NOT applied to
-- production directly. Promotion path is migration-based:
--
--     dev/maintenance-agent   (author + validate here)
--         ↓  (same file)
--     development             (integration test)
--         ↓  (same file)
--     production              (final apply)
--
-- The identical file is the SAME artifact promoted through each environment —
-- Lakebase does NOT auto-merge database branches. Branches give an instant,
-- isolated copy of production state to develop against; migrations carry the
-- validated change forward. See agent_workflow/BRANCHING_WORKFLOW.md.
-- ============================================================================

BEGIN;

-- ── maintenance_actions ───────────────────────────────────────────────────────
-- Records a plant-manager maintenance decision: the evaluated action, its
-- expected downtime avoided, cost, estimated net value, approval status, actor.
CREATE TABLE IF NOT EXISTS app.maintenance_actions (
    action_id                       BIGSERIAL PRIMARY KEY,
    line_id                         TEXT NOT NULL REFERENCES app.production_lines(line_id),
    evaluated_action                TEXT NOT NULL
                                    CHECK (evaluated_action IN ('pull_now','run_to_shift_end','expedite_parts_and_run')),
    action_cost_usd                 NUMERIC(12,2),
    approval_status                 TEXT NOT NULL DEFAULT 'proposed'
                                    CHECK (approval_status IN ('proposed','approved','rejected','executed')),
    actor                           TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_actions_line_idx   ON app.maintenance_actions(line_id);
CREATE INDEX IF NOT EXISTS maintenance_actions_status_idx ON app.maintenance_actions(approval_status);

-- Branch-only enrichment columns the plant-manager decision surface needs.
-- (Kept as separate ALTERs so the diff clearly shows the branch evolution.)
ALTER TABLE app.maintenance_actions
    ADD COLUMN IF NOT EXISTS expected_downtime_avoided_hours NUMERIC;

ALTER TABLE app.maintenance_actions
    ADD COLUMN IF NOT EXISTS estimated_net_value_usd NUMERIC;

-- ── Branch-only test decisions for the hero line (LINE-04) ───────────────────
-- These rows exist to validate the schema on the developer branch. They must
-- NOT appear on production until the migration is promoted.
INSERT INTO app.maintenance_actions
    (line_id, evaluated_action, action_cost_usd, expected_downtime_avoided_hours, estimated_net_value_usd, approval_status, actor)
VALUES
    ('LINE-04','pull_now',               8000.00, 4.0,  80000.00, 'proposed','dev/maintenance-agent'),
    ('LINE-04','run_to_shift_end',          0.00, 0.0, -75680.00, 'proposed','dev/maintenance-agent'),
    ('LINE-04','expedite_parts_and_run',12000.00, 2.4,  40800.00, 'proposed','dev/maintenance-agent');

COMMIT;

-- ── Rollback considerations ──────────────────────────────────────────────────
-- To roll back on any branch (safe, additive migration):
--   DROP TABLE IF EXISTS app.maintenance_actions;
-- No existing tables are altered destructively; production data is untouched by
-- forward apply. Promotion to production should run inside a transaction (above)
-- and be verified with queries/validate_migration.sql immediately after.
