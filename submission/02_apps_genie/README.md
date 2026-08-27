# Build 2 — Databricks App + Genie (Volta Plant Floor)

## WHAT THIS BUILD PROVES

A plant manager gets machine health, failure risk, natural-language
investigation, a ranked maintenance decision, and a one-click approved action —
all in one governed Databricks App. It answers the hero question:

> **Line 4 is trending toward a stop. Pull it now or run it to the end of the shift?**

- Live operational state from **Lakebase** (low latency).
- Analytical investigation via a **Genie Agent** over governed Unity Catalog data.
- A ranked decision (pull_now / run_to_shift_end / expedite_parts_and_run) with
  cost/benefit per option.
- **Human-in-the-loop**: the agent drafts a work order; the manager approves; only
  then is it written to Lakebase (append-only audit).

## ARCHITECTURE

```text
React / TypeScript client  ──►  Node/Express (AppKit) backend
                                   ├── Lakebase Postgres      (operational reads + the single write)
                                   ├── Databricks SQL         (governed analytics)
                                   ├── Genie Agent (ask_data) (NL investigation)
                                   └── AI-Gateway-governed model endpoint (agent brain, tagged)

Agent tools (server/agent/plantfloor.ts):
  ask_data                  → Genie space (why / what-happened)          [Build-1 backend choice]
  find_atrisk_line          → Lakebase app.open_atrisk + app.line_status [implemented]
  rank_maintenance_actions  → Lakebase app.maintenance_recommendations    [implemented]
  search_parts              → Lakebase Search over app.parts              [implemented]
  execute_maintenance_action→ Lakebase app.work_orders_app WRITE (gated)  [implemented]
```

Genie vs deterministic split — **Genie** for why/pattern/what-changed; **direct
Lakebase lookups** for current stock, work-order status, the recommendation
record, and all writes. This keeps the architecture predictable and the writes
governed + auditable.

## PREREQUISITES

- The Lakebase database from Build 1 (schema `app`, synced mirrors + `work_orders_app`).
- A Genie space "Volta Plant Operations" (see `genie/genie_space_config.md`), wired via `GENIE_SPACE_ID`.
- A Responses-API model serving endpoint for the agent (`config/app.json` `agentModel`), ideally AI-Gateway-governed (Build 3).
- Node 22+, Databricks CLI. App runs via `../../app/start.sh` (dev) or `databricks bundle deploy` + app deploy.

## FILES

| Path | Purpose |
|---|---|
| `app/README.md` | Map of the implemented app files + what Build 2 built. |
| `app/plantfloor.ts` | Snapshot: agent + 5 tools + hero chain + AI-Gateway tagging. |
| `app/maintenance.ts` | Snapshot: Lakebase query helpers (reads + the write). |
| `app/schema.ts` | Snapshot: Drizzle schema for `app.*`. |
| `app/app.json`, `app/app.yaml` | Snapshot: wiring + OBO scopes. |
| `genie/genie_space_config.md` | Genie space scope, business definitions, permissions. |
| `genie/sample_questions.md` | Suggested questions + expected answers + Genie SQL. |
| `evidence/CAPTURE_REQUIRED.md` | Exact screenshots/recordings to capture. |

## HOW TO RUN

```bash
cd ../../app
cp .env.example .env 2>/dev/null || true   # set DATABRICKS_HOST, GENIE_SPACE_ID, DEMO_CATALOG/SCHEMA
databricks auth login --host "$DATABRICKS_HOST"
./start.sh            # installs deps, builds client, boots on 8765
# open http://localhost:8765 → the assistant dock runs the scripted hero flow.
```

## HOW TO VALIDATE (the hero workflow, end-to-end)

In the assistant (dock or `/c/:id`), run the scripted chain (`config/app.json`
`assistantScript`):

1. **"Why is LINE-04 trending toward a stop, and what are my options?"**
   → `ask_data` (Genie) investigates + `find_atrisk_line` returns LINE-04 / PLANT-03,
   risk ≈ 0.87, non-local part, open corrective WO.
2. **"Rank the action. Use the model."**
   → `rank_maintenance_actions` returns all three plays with $; agent recommends
   **pull_now**, drafts the work order, and **STOPS for approval**.
3. **"Yes — pull the line now."**
   → `execute_maintenance_action` writes to `app.work_orders_app`
   (`status=approved`, `approved_by=<you>`, audit entry). The Operations/queue
   view refetches live via `dataMutated`.

Each tool call appears in the Thinking panel and the MLflow trace.

## EXPECTED RESULT

- Recommendation is **PULL NOW** for LINE-04, justified by risk + non-local part.
- All three options are compared with predicted cost avoided / net value.
- The approved work order lands in Lakebase and the queue updates without reload.
- No silent AI write — the write happens only after explicit approval.

## EVIDENCE

- Machine-verifiable: the tool calls + the `app.work_orders_app` row written after
  approval (query it), and the MLflow trace of the turn.
- Manual UI evidence: see `evidence/CAPTURE_REQUIRED.md` (plant-floor / detail /
  Genie answer / approval → live update / Genie permissions).

## ACCEPTANCE TEST

```text
[COMPLETE] deployed/runnable Databricks App ............... app/ (start.sh / bundle)
[PARTIAL ] plant-floor view ............................... Operations write-surface + KPIs + live cascade exist;
                                                            re-theme labels/columns to plant-floor (see evidence)  ▲
[COMPLETE] live operational line state displayed .......... operational_queries + Operations view (Lakebase)
[COMPLETE] risk prioritisation visible .................... worstAtriskLine orders by downtime_exposure DESC
[COMPLETE] LINE-04 visible / detail available ............. find_atrisk_line + hero detail query; drawer  ▲(re-theme)
[COMPLETE] Genie Agent connected .......................... ask_data → Genie (genie/genie_space_config.md)
[COMPLETE] natural-language analysis works ................ ask_data hero investigation
[COMPLETE] hero question works ............................ 3-phase chain (validate steps above)
[COMPLETE] alternatives are compared ...................... rank_maintenance_actions (all three plays)
[COMPLETE] recommended action clearly displayed .......... agent draft: PULL NOW + why
[COMPLETE] work order can be drafted ...................... Phase-2 draft
[COMPLETE] human approval required ........................ Phase-3 gate; execute only after approval
[COMPLETE] approved action stored operationally ........... execute_maintenance_action → app.work_orders_app
```
`▲` = the operational write-surface exists and is wired (KPIs + table + drawer +
live `dataMutated` cascade), themed as the template's returns queue; the remaining
work is re-labelling it to plant-floor columns. The hero decision + action loop
runs fully through the assistant today. This is the TOP remaining item — tracked
in `../connected_solution/EVIDENCE_MATRIX.md`.
