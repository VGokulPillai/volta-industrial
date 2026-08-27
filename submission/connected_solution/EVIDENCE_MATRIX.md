# Evidence Matrix

Status legend: **COMPLETE** (implemented + self-contained/verifiable) ·
**PARTIAL** (implemented but needs re-theme/extension) ·
**MANUAL EVIDENCE REQUIRED** (implemented; live UI screenshot/observed value needed) ·
**BLOCKED**.

Paths are relative to `submission/`. "Live resource" = the workspace object the
requirement runs against (provided via env / captured, never fabricated here).

## Build 1 — Lakebase

| Requirement | Implementation | File | Live resource | Validation command | Screenshot? | Status |
|---|---|---|---|---|---|---|
| Operational data model | plants/lines/machine_state/parts/work_orders/notes + seed | `01_lakebase/migrations/001_operational_schema.sql` | Lakebase DB `volta_operations` | `psql "$PROD_URL" -f 01_lakebase/migrations/001_operational_schema.sql` | No | COMPLETE |
| LINE-04 strong-failure scenario | risk 0.87/critical, non-local part, open WO | `01_lakebase/migrations/001_operational_schema.sql` | Lakebase | `01_lakebase/queries/operational_queries.sql` (hero detail) | No | COMPLETE |
| Branch workflow (prod→dev→agent) | branch tree + CLI + lifecycle | `01_lakebase/agent_workflow/BRANCHING_WORKFLOW.md` | Lakebase branches | `databricks postgres list-branches ...` | Yes (`01`) | MANUAL EVIDENCE REQUIRED |
| Coding-agent schema change | maintenance_actions + enrichment cols, as migration | `01_lakebase/migrations/002_maintenance_actions.sql`, `agent_workflow/AGENT_PROMPT.md` | agent branch | `psql "$AGENT_URL" -f .../002...sql` | No | COMPLETE |
| Prove isolation | change on agent branch, absent on prod | `01_lakebase/queries/verify_branch_isolation.sql` | both branches | run on agent then prod, compare | Yes (`02,03,04`) | MANUAL EVIDENCE REQUIRED |
| Validate before promotion | constraints/FK/search/fleet checks | `01_lakebase/queries/validate_migration.sql` | agent branch | `psql "$AGENT_URL" -f .../validate_migration.sql` | Yes (`05`) | MANUAL EVIDENCE REQUIRED |
| Promotion procedure | migration-based prod promotion | `01_lakebase/agent_workflow/BRANCHING_WORKFLOW.md` | dev/prod branches | run 002 on development then production | No | COMPLETE |
| Hybrid search | tsvector (Tier 1) + pgvector (Tier 2) over notes | `01_lakebase/search/setup_search.sql`, `example_queries.sql`; app `searchParts` | Lakebase | `psql "$URL" -f 01_lakebase/search/example_queries.sql` | Yes (`06`) | MANUAL EVIDENCE REQUIRED |

## Build 2 — Databricks App + Genie

| Requirement | Implementation | File | Live resource | Validation command | Screenshot? | Status |
|---|---|---|---|---|---|---|
| Runnable Databricks App | AppKit React+Node app | `app/` (repo root); snapshots `02_apps_genie/app/` | Databricks App | `app/start.sh` / `databricks bundle deploy` | Yes (`01`) | MANUAL EVIDENCE REQUIRED |
| Live operational line state | Lakebase reads | `02_apps_genie/app/maintenance.ts` (`worstAtriskLine`,`getLineStatus`) | Lakebase | run app → floor view | Yes (`01`) | COMPLETE (backend) |
| Risk prioritisation / LINE-04 visible | order by downtime_exposure DESC | `02_apps_genie/app/maintenance.ts`, `plantfloor.ts` | Lakebase | hero flow step 1 | Yes (`01,02`) | COMPLETE (backend) |
| Dedicated plant-floor page + LINE-04 drawer | write-surface + KPIs + drawer + live cascade exist (returns-themed) | `app/client/src/operations/*` | Databricks App | run app | Yes (`01,02`) | PARTIAL (re-theme labels/columns to plant-floor) |
| Genie Agent connected | `ask_data` → Genie space | `02_apps_genie/genie/genie_space_config.md`, `app/plantfloor.ts` | Genie space (`GENIE_SPACE_ID`) | hero flow step 5 | Yes (`03,06`) | MANUAL EVIDENCE REQUIRED |
| Hero question / ranked options | 3-phase chain + `rank_maintenance_actions` | `02_apps_genie/app/plantfloor.ts` | Lakebase + model | hero flow steps 1–2 | Yes (`04`) | COMPLETE (backend) |
| Draft + human approval gate | Phase 2/3 instructions | `02_apps_genie/app/plantfloor.ts` | model | hero flow steps 2–3 | Yes (`04,05`) | COMPLETE |
| Approved action stored operationally | `execute_maintenance_action` → `work_orders_app` | `02_apps_genie/app/plantfloor.ts`, `maintenance.ts` (`recordMaintenanceAction`) | Lakebase | after approval, query `app.work_orders_app` | Yes (`05`) | COMPLETE (backend) |
| MLflow tracing per tool | `mlflow.withSpan` on each tool | `02_apps_genie/app/plantfloor.ts` | MLflow experiment | hero turn → trace | Yes (`07`) | MANUAL EVIDENCE REQUIRED |

## Build 3 — Unity AI Gateway

| Requirement | Implementation | File | Live resource | Validation command | Screenshot? | Status |
|---|---|---|---|---|---|---|
| Generative calls use governed service | `ai-gateway` scope + agent endpoint | `02_apps_genie/app/app.yaml`, `app.json` | serving endpoint | inspect endpoint | Yes (`01`) | MANUAL EVIDENCE REQUIRED |
| Bounded — rate limits | QPM+TPM service+user | `03_ai_gateway/config/ai_gateway_config.json`, `apply_gateway_config.sh` | serving endpoint | `bash .../apply_gateway_config.sh` | Yes (`01,06`) | MANUAL EVIDENCE REQUIRED |
| Rate limits documented/justified | 8-plant sizing | `03_ai_gateway/config/RATE_LIMIT_RATIONALE.md` | — | read | No | COMPLETE |
| Visible — usage tracking | `usage_tracking_config.enabled` | `03_ai_gateway/config/ai_gateway_config.json` | `system.ai_gateway.usage` | `executive_usage.sql` | Yes (`02`) | MANUAL EVIDENCE REQUIRED |
| `system.ai_gateway.usage` query | executive aggregations | `03_ai_gateway/queries/executive_usage.sql` | Databricks SQL | run in SQL editor | Yes (`02`) | COMPLETE (query) |
| Attributable — request tags | `Databricks-Ai-Gateway-Request-Tags` header | `02_apps_genie/app/plantfloor.ts` | serving endpoint | control test → usage query | Yes (`02,03`) | COMPLETE (code) |
| Attribute to app/user/plant/feature | request_tags aggregations | `03_ai_gateway/queries/executive_usage.sql` | `system.ai_gateway.usage` | run query | Yes (`03`) | MANUAL EVIDENCE REQUIRED |
| Inference logging | `inference_table_config.enabled` | `03_ai_gateway/config/ai_gateway_config.json` | inference table | query payload table | Yes (`05`) | MANUAL EVIDENCE REQUIRED |
| Investigation query | window/user/endpoint/plant | `03_ai_gateway/queries/investigate_usage_spike.sql` | Databricks SQL | run parameterized | Yes (`04`) | COMPLETE (query) |
| Deliberate safe control test | tiny tagged requests + bounded burst | `03_ai_gateway/tests/test_gateway_tags.py` | serving endpoint | `python3 .../test_gateway_tags.py` | Yes (`06`) | MANUAL EVIDENCE REQUIRED |
| Executive report | bounded/visible/attributable/investigable | `03_ai_gateway/EXECUTIVE_REPORT.md` | (observed values) | — | No | COMPLETE (values pending run) |
| $1,200 incident addressed | incident→outcome narrative | `03_ai_gateway/EXECUTIVE_REPORT.md` | — | read | No | COMPLETE |

## Connected

| Requirement | File | Status |
|---|---|---|
| Architecture (responsibilities) | `connected_solution/ARCHITECTURE.md` | COMPLETE |
| Demo script (one story) | `connected_solution/DEMO_SCRIPT.md` | COMPLETE |
| Evidence matrix | `connected_solution/EVIDENCE_MATRIX.md` | COMPLETE |

## Top remaining items (to move PARTIAL/MANUAL → COMPLETE)

1. **Provision live resources** (Lakebase branches, Genie space, AI-Gateway config)
   and capture the screenshots listed in each build's `evidence/CAPTURE_REQUIRED.md`.
2. **Re-theme the operational page** from the returns template to plant-floor
   labels/columns (the write-surface, KPIs, drawer, and live cascade already work).
3. **Run the control test + usage queries** to populate the `<observed>` values in
   `EXECUTIVE_REPORT.md`.
