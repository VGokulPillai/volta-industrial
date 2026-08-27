# Lakebase — Execution Evidence

Every claim below is backed by a **live run** on the workspace
`fevm-serverless-stable-wx20co`, Lakebase project `volta-maintenance`. The raw
machine outputs are committed next to this file:

- [`output/lakebase_evidence.json`](output/lakebase_evidence.json) — schema/agent/domain/search/forward-sync/reverse-sync run
- [`output/branch_evidence.json`](output/branch_evidence.json) — dev + throwaway branch isolation run

Both were produced by serverless notebooks committed in this folder
([`run_evidence_notebook.py`](run_evidence_notebook.py),
[`run_branch_evidence_notebook.py`](run_branch_evidence_notebook.py)) and run as
Databricks Jobs. The notebooks mint a short-lived Lakebase OAuth credential
in-workspace (no secret leaves Databricks), connect over `psycopg2`, and emit the
JSON via `dbutils.notebook.exit`.

---

## 1. Lakehouse → Lakebase sync

### 1.1 Lakebase instance defined + connectivity check (ran)
- Project `volta-maintenance`, default branch `production`, endpoint `primary`
  (`ep-steep-moon-d2x11wbr...`).
- Connectivity is proven by every query in the JSON: `connected_as` =
  `gokul.pillai@databricks.com`, and reads/writes succeed against `app.*`.

### 1.2 Governed UC table synced into Lakebase → returns rows (ran)
Forward sync reads the governed UC gold table
`serverless_stable_wx20co_catalog.dev_gokul_pillai_volta_industrial.gold_line_status`
(critical/elevated lines) and upserts into `app.line_status_synced`.

- `forward_sync_rowcount`: **25**
- Sample (highest downtime exposure first):

| line_id | plant_name | failure_risk_score | downtime_exposure_usd | risk_band |
|---|---|---|---|---|
| LINE-0031 | Detroit | 0.95 | 41,800 | critical |
| LINE-0928 | Portland | 0.95 | 41,800 | critical |
| LINE-1032 | Phoenix | 0.95 | 41,800 | critical |
| LINE-0902 | Pittsburgh | 0.95 | 41,800 | critical |
| LINE-0317 | Pittsburgh | 0.95 | 41,800 | critical |

### 1.3 Operational schema modeled for the domain (ran)
Tables present on the `app` schema after migration (from `schema_after`):
`machine_state, maintenance_actions, maintenance_notes, parts_inventory, plants,
production_lines, work_orders` — related by keys
(`production_lines.plant_id → plants`, `machine_state.line_id → production_lines`,
`work_orders.required_part_id → parts_inventory`, etc). See
[`migrations/001_operational_schema.sql`](../migrations/001_operational_schema.sql).

### 1.4 Separate writable Postgres tables (verified)
`app.work_orders`, `app.maintenance_actions`, `app.line_status_synced` are all
writable and distinct from any read-only mirror — the runs INSERT/UPDATE them
directly (see reverse-sync + branch runs).

### 1.5 Sync defined as code, not UI (verified)
See [`databricks.yml`](../../../databricks.yml) and the committed notebooks — the
schema, gold tables, and both sync directions are code.

### 1.6 Reverse Lakehouse Sync: Postgres → UC Delta with SCD Type 2 (ran)
`reverse_sync()` streams `app.work_orders` into the UC Delta table
`...work_orders_history` with SCD Type 2 + system metadata columns
(`__is_current, __start_at, __end_at, __synced_at, __source`).

We then changed `WO-10004` status `open → approved` in Postgres and re-ran the
sync. The Delta history for `WO-10004` shows the closed + current versions:

| work_order_id | status | __is_current | __start_at | __end_at | __source |
|---|---|---|---|---|---|
| WO-10004 | open | false | 11:51:39 | 11:51:46 | lakebase:volta-maintenance/production |
| WO-10004 | approved | true | 11:51:46 | (null) | lakebase:volta-maintenance/production |

- `reverse_sync_metadata_columns`: `__is_current, __start_at, __end_at, __synced_at, __source`

---

## 2. Branching (dev iteration + throwaway forecasting) — ran

Three branches exist and are `READY` (`branch_evidence.json → branches`):
`production` (default), `dev-maintenance-agent`, `forecasting-what-if`. They were
created in code via the Postgres REST API with `spec.no_expiry` / `spec.ttl`
(scale-to-zero endpoints, `min_cu=max_cu=1`, `suspend_timeout=86400s`).

### 2.1 Development iteration — `dev-maintenance-agent`
- Inherited production state instantly: `inherited_work_orders = 3` = production baseline (`matches_production_baseline: true`).
- Isolated dev change: inserted `WO-DEV-04` → dev now has **4** work orders.
- **Isolation proof:** production still shows **3** work orders and
  `production_sees_dev_row = 0`.

### 2.2 Throwaway forecasting — `forecasting-what-if`
- Question: *"If risk drifts up +0.15 across elevated/watch lines, how many lines become critical?"*
- Result: critical lines **1 → 2** on the scratch branch (LINE-11 tips into critical).
- **Isolation proof:** production critical count stays **1** and LINE-04 risk is
  unchanged (`production_line04_risk_unchanged: true`). The branch is discarded.

---

## 3. Agentic development — ran

### 3.1 Coding agent's change committed as a migration
[`migrations/002_maintenance_actions.sql`](../migrations/002_maintenance_actions.sql)
— authored on `dev/maintenance-agent`: creates `app.maintenance_actions`, adds two
enrichment columns via `ALTER TABLE`, seeds branch-only decision rows.

### 3.2 Schema diff captured (ran)
- `schema_before`: `machine_state, maintenance_notes, parts_inventory, plants, production_lines, work_orders`
- `schema_after` adds: **`maintenance_actions`**  (`agent_added_tables: ["maintenance_actions"]`)
- Final columns include the two agent-added enrichment columns
  `expected_downtime_avoided_hours`, `estimated_net_value_usd`.

### 3.3 Change validated by a query + result (ran)
Ranking the seeded decisions for LINE-04 by estimated net value
(`agent_validation` / `agent_validation_winner`):

| evaluated_action | action_cost_usd | estimated_net_value_usd |
|---|---|---|
| **pull_now** | 8,000 | **80,000** ✅ argmax |
| expedite_parts_and_run | 12,000 | 40,800 |
| run_to_shift_end | 0 | −75,680 |

Validated winner: **`pull_now`** (net value **$80,000**).

---

## 4. Lakebase Search — ran

Hybrid full-text search over `app.maintenance_notes.search_tsv` for the
natural-language query **"bearing vibration grinding noise"** (`search_results`):

| note_id | line_id | rank | technician_note (excerpt) |
|---|---|---|---|
| NOTE-0001 | LINE-04 | 0.4106 | "Drive-side **bearing vibration** increased… **grinding noise** observed at high load…" |

The top hit is the hero line's note — the query returns the relevant record.

---

## 5. Domain question — ran (low-latency Lakebase join)

**Q:** *"Which at-risk line should we act on first, what is the recommended
action, and is the replacement part stocked locally?"* (`domain_answer`)

**A (top row):** **LINE-04** (Columbus) — `failure_risk_score 0.87`, band
`critical`, agent-recommended **`pull_now`** (net value $80,000). Replacement part
`SEAL-040-VOLT` is **NOT stocked locally** (`part_local=false`, `lead_time_days=14`)
— so the right call is pull now rather than wait on the part.

| line_id | plant | risk | band | recommended | part | part_local | lead_days |
|---|---|---|---|---|---|---|---|
| LINE-04 | Columbus | 0.87 | critical | pull_now | SEAL-040-VOLT | false | 14 |
| LINE-11 | Columbus | 0.61 | elevated | — | HYD-118-VOLT | true | 3 |
| LINE-66 | Dallas | 0.55 | elevated | — | BLT-090-VOLT | true | 1 |

---

## How to reproduce

```bash
# import + run either notebook as a serverless job, then read the exit JSON
databricks workspace import /Workspace/Users/<you>/volta_evidence \
  --file submission/01_lakebase/evidence/run_evidence_notebook.py \
  --language PYTHON --format SOURCE --overwrite -p <profile>
databricks jobs submit --json '{"run_name":"volta-evidence","tasks":[{"task_key":"e","notebook_task":{"notebook_path":"/Workspace/Users/<you>/volta_evidence"}}]}' -p <profile>
# fetch: databricks jobs get-run-output <task_run_id> -p <profile>
```
