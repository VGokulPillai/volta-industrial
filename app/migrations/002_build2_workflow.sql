-- Build 2 app-owned state only. Existing Build 1 operational and search tables
-- are intentionally not altered.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.system_decision_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id text NOT NULL,
  trigger text NOT NULL DEFAULT 'line_status_read',
  ranked_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text NOT NULL
    CHECK (recommended_action IN ('pull_now','run_to_shift_end','expedite_parts_and_run')),
  flagged boolean NOT NULL DEFAULT false,
  scored_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS system_decision_scores_line_trigger_uq
  ON app.system_decision_scores(line_id, trigger);
CREATE INDEX IF NOT EXISTS system_decision_scores_flagged_idx
  ON app.system_decision_scores(flagged, scored_at);

CREATE TABLE IF NOT EXISTS app.maintenance_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id text NOT NULL,
  trigger text NOT NULL DEFAULT 'system'
    CHECK (trigger IN ('system','assistant','operator')),
  score_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text NOT NULL
    CHECK (recommended_action IN ('pull_now','run_to_shift_end','expedite_parts_and_run')),
  proposed_action text NOT NULL
    CHECK (proposed_action IN ('pull_now','run_to_shift_end','expedite_parts_and_run')),
  proposed_by text NOT NULL,
  memo text NOT NULL,
  drafted_work_order text NOT NULL,
  approval_status text NOT NULL DEFAULT 'proposed'
    CHECK (approval_status IN ('proposed','approved','rejected','corrected')),
  approver text,
  correction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  committed_at timestamptz
);
CREATE INDEX IF NOT EXISTS maintenance_workflows_line_idx
  ON app.maintenance_workflows(line_id, created_at);
CREATE INDEX IF NOT EXISTS maintenance_workflows_status_idx
  ON app.maintenance_workflows(approval_status);

CREATE TABLE IF NOT EXISTS app.assistant_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES app.conversations(id) ON DELETE SET NULL,
  user_email text NOT NULL,
  intent text NOT NULL,
  tools_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text,
  outcome text NOT NULL CHECK (outcome IN ('completed','failed','canceled')),
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_interactions_conversation_idx
  ON app.assistant_interactions(conversation_id);
CREATE INDEX IF NOT EXISTS assistant_interactions_user_idx
  ON app.assistant_interactions(user_email, created_at);
