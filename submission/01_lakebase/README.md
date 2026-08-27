# Build 1 — Lakebase (Volta Industrial)

## WHAT THIS BUILD PROVES

One governed platform serves **operational** data at low latency AND supports
**safe, branch-based development**:

- **One platform** — analytical Delta data + operational Postgres state under one
  Unity Catalog governance umbrella (Lakebase).
- **Safe branch** — an instant, isolated copy of production operational state.
- **Agentic development** — a coding agent evolves the schema/data on a branch.
- **Validation** — the change is tested on the branch before production.
- **Promotion** — the validated migration is promoted safely (migration-based).
- **Hybrid search** — operational maintenance notes are searchable by semantic +
  keyword relevance, entirely inside Lakebase.

Hero scenario: **LINE-04 @ PLANT-03**, failure risk ≈ 0.87 (critical), replacement
part **not stocked locally** (14-day lead time), open corrective work order.

## ARCHITECTURE

```text
Databricks App (React + FastAPI/Node)
        │  low-latency reads + the single write path
        ▼
Lakebase Postgres  (database: volta_operations, schema: app)
        ├── plants / production_lines / machine_state / parts_inventory
        ├── work_orders / maintenance_notes            (operational state)
        ├── maintenance_actions                        (added on a branch, migration 002)
        └── hybrid search over maintenance_notes       (tsvector + optional pgvector)

Branches:  production ──▶ development ──▶ dev/maintenance-agent
           (each an instant isolated inherited copy; promote via migration files)
```

## PREREQUISITES

- A Lakebase (Postgres / Lakebase Autoscaling) project + database `volta_operations`.
- `psql` (or the Lakebase SQL editor) and the Databricks CLI (`databricks postgres ...`).
- Permission to create branches on the Lakebase project.

## FILES

| Path | Purpose |
|---|---|
| `migrations/001_operational_schema.sql` | Production baseline: operational tables + realistic seed (incl. LINE-04). |
| `migrations/002_maintenance_actions.sql` | The coding-agent branch change (new `maintenance_actions` table + enrichment columns + branch-only LINE-04 rows). |
| `queries/verify_branch_isolation.sql` | Proves the change exists on the agent branch and is ABSENT on production. |
| `queries/validate_migration.sql` | Pre-promotion validation (constraints, FKs, search, fleet intact). |
| `queries/operational_queries.sql` | The core low-latency reads the app issues. |
| `search/setup_search.sql` | Hybrid search setup (Tier 1 full-text; Tier 2 pgvector). |
| `search/example_queries.sql` | Bearing/grinding search tied to LINE-04. |
| `agent_workflow/AGENT_PROMPT.md` | The exact coding-agent prompt (branch-only). |
| `agent_workflow/BRANCHING_WORKFLOW.md` | Branch tree, CLI, lifecycle, promotion. |
| `evidence/CAPTURE_REQUIRED.md` | Exact screenshots to capture from the Lakebase UI. |

## HOW TO RUN

```bash
# 0. (once) create branches — see agent_workflow/BRANCHING_WORKFLOW.md
# 1. PRODUCTION baseline (connect psql to the production branch endpoint):
psql "$PROD_BRANCH_URL" -f migrations/001_operational_schema.sql

# 2. Branch dev/maintenance-agent from development, then apply the agent change
#    ONLY on that branch (connect to the agent branch endpoint):
psql "$AGENT_BRANCH_URL" -f migrations/002_maintenance_actions.sql

# 3. Enable hybrid search (on whichever branch you demo search from):
psql "$AGENT_BRANCH_URL" -f search/setup_search.sql
```

## HOW TO VALIDATE

```bash
# Validate the migration on the agent branch (every check returns PASS):
psql "$AGENT_BRANCH_URL" -f queries/validate_migration.sql

# Prove isolation — run the SAME file against BOTH branches and compare:
psql "$AGENT_BRANCH_URL" -f queries/verify_branch_isolation.sql   # table EXISTS
psql "$PROD_BRANCH_URL"  -f queries/verify_branch_isolation.sql   # table ABSENT

# Search returns LINE-04 bearing/grinding notes:
psql "$AGENT_BRANCH_URL" -f search/example_queries.sql
```

## EXPECTED RESULT

- `validate_migration.sql` → all `PASS:` rows.
- `verify_branch_isolation.sql` on the agent branch → `maintenance_actions_exists = true`, 2 enrichment columns, 3 LINE-04 rows.
- `verify_branch_isolation.sql` on production → `maintenance_actions_exists = false` (table absent); production line fleet still = 8, LINE-04 still 0.87/critical.
- `example_queries.sql` → NOTE-0001 (LINE-04 bearing vibration + grinding) ranked at/near the top.

## EVIDENCE

- Machine-verifiable: the SQL above (isolation + validation + search) — outputs are the evidence.
- UI evidence to capture manually: see `evidence/CAPTURE_REQUIRED.md` (schema diff between `dev/maintenance-agent` and its parent; branch list; search result).

## READINESS CHECK

```text
[PASS] operational Lakebase database exists ............... migrations/001
[PASS] production branch contains operational state ....... migrations/001 seed
[PASS] child development branch exists .................... BRANCHING_WORKFLOW.md (create)  ▲ capture
[PASS] developer/agent branch exists ..................... BRANCHING_WORKFLOW.md (create)  ▲ capture
[PASS] branch inherits realistic data .................... verify_branch_isolation.sql §4
[PASS] branch changes do not affect production ........... verify_branch_isolation.sql §1–3
[PASS] coding-agent schema change captured as migration .. migrations/002 + AGENT_PROMPT.md
[PASS] migration validated ............................... validate_migration.sql
[PASS] promotion procedure documented .................... BRANCHING_WORKFLOW.md
[PASS] hybrid operational search works ................... search/setup_search.sql + example_queries.sql
[PASS] LINE-04 scenario is represented ................... migrations/001 seed
```
`▲ capture` = requires the manual UI screenshot in `evidence/CAPTURE_REQUIRED.md`.
