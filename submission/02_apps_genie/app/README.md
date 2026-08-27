# App source snapshots — Build 2

The live app is the full Databricks App at the repo root `app/` (React/TypeScript
client + Node/Express backend via `@databricks/appkit`, Lakebase, MLflow, Genie).
This folder holds **snapshots of the files this build implemented**, so the Build 2
ZIP is understandable on its own without opening the app tree.

| Snapshot | Live path | What it is |
|---|---|---|
| `plantfloor.ts` | `app/server/agent/plantfloor.ts` | The plant-floor agent: the 5 tools (`ask_data`, `find_atrisk_line`, `rank_maintenance_actions`, `search_parts`, `execute_maintenance_action`), the 3-phase hero chain instructions, and the AI-Gateway request-tagging shim (Build 3). |
| `maintenance.ts` | `app/server/db/queries/maintenance.ts` | Lakebase query helpers backing the tools (reads + the single transactional write `recordMaintenanceAction`). |
| `schema.ts` | `app/server/db/schema.ts` | Drizzle schema for the Lakebase `app.*` tables (mirrors + writable `work_orders_app`). |
| `app.json` | `app/config/app.json` | Wiring: `genieSpaceId`, `agentModel`, data source tables, assistant script. |
| `app.yaml` | `app/app.yaml` | App manifest: OBO scopes (`genie`, `postgres`, `ai-gateway`, …). |

## What Build 2 implemented (previously stubbed / `throw "not implemented"`)

- `find_atrisk_line` → reads the worst at-risk line + status from Lakebase.
- `rank_maintenance_actions` → reads the ML-ranked options (all three plays).
- `search_parts` → hybrid full-text search over `app.parts` (Lakebase Search).
- `execute_maintenance_action` → the approval-gated, transactional write to
  `app.work_orders_app` (human-in-the-loop close-the-loop).
- The 5 query helpers in `maintenance.ts`.
- AI Gateway request tagging (Build 3 hook) in the OpenAI client fetch shim.

`ask_data` (Genie/MAS investigation) shipped working and is unchanged.

## Human-in-the-loop write (the close-the-loop moment)

`execute_maintenance_action` is **only** called after the user explicitly approves
(Phase 3 in the agent instructions). It writes one `app.work_orders_app` row with
`status='approved'`, `approved_by = <OBO user email>`, and an append-only audit
entry — never a silent AI write. On commit the client's `dataMutated` cascade
refetches the Plant Floor view live.
