# Coding-Agent Prompt — evolve the Volta operational schema on a branch

> This is the exact prompt used to drive a coding agent (Genie Code / Claude Code
> / Cursor) to evolve the Lakebase operational schema **safely on a branch**. The
> agent's output is captured as migration `../migrations/002_maintenance_actions.sql`
> and validated with `../queries/validate_migration.sql` before any promotion.

---

```text
You are working EXCLUSIVELY against the `dev/maintenance-agent` Lakebase branch.

Do NOT modify production. Do NOT modify the `development` branch. Only the
`dev/maintenance-agent` branch.

Context:
- Lakebase Postgres database: volta_operations, schema `app`.
- The production branch holds live operational state: plants, production_lines,
  machine_state, parts_inventory, work_orders, maintenance_notes.
- LINE-04 @ PLANT-03 is the hero: failure_risk_score ~0.87, risk_band=critical,
  its replacement part (SEAL-040-VOLT) is NOT stocked locally (14-day lead time),
  and it has an open corrective work order.

Task:
Inspect the current Volta operational schema. Add support for plant-manager
maintenance decisions by creating a `maintenance_actions` table that records:
  - line               (FK to app.production_lines)
  - evaluated action   (pull_now | run_to_shift_end | expedite_parts_and_run)
  - expected downtime avoided (hours)
  - action cost (USD)
  - estimated net value (USD)
  - approval status    (proposed | approved | rejected | executed)
  - actor
  - created/updated timestamps

Add appropriate indexes and CHECK constraints (valid action + status enums, FK).
Add the two enrichment columns via explicit ALTER statements so the schema diff
clearly shows the branch evolution:
  ALTER TABLE app.maintenance_actions ADD COLUMN expected_downtime_avoided_hours NUMERIC;
  ALTER TABLE app.maintenance_actions ADD COLUMN estimated_net_value_usd NUMERIC;

Deliver the change as a MIGRATION FILE (002_maintenance_actions.sql) — do NOT
modify production manually. Wrap DDL + seed in a transaction.

Seed branch-only test decisions for LINE-04 (all three evaluated actions), with
pull_now netting the highest value (part non-local ⇒ delay is costliest).

Then run validation queries:
  1. table + branch-only columns exist
  2. CHECK constraint rejects an invalid action
  3. LINE-04 can accept >= 3 actions
  4. no orphan actions (FK holds)
  5. existing work_orders → parts FK intact
  6. hybrid search still returns results
  7. line fleet still = 8

Return:
  1. the schema changes (DDL)
  2. the migration file
  3. the validation results
  4. rollback considerations (DROP TABLE app.maintenance_actions; additive/safe)

Do NOT promote anything to production. Promotion is a separate, gated step that
runs the SAME migration file against `development` then `production`.
```

---

## What the agent produced (captured, in source control)

| Artifact | File |
|---|---|
| Migration | `../migrations/002_maintenance_actions.sql` |
| Validation | `../queries/validate_migration.sql` |
| Isolation proof | `../queries/verify_branch_isolation.sql` |
| Branching workflow | `./BRANCHING_WORKFLOW.md` |

The agent's changes were confined to the `dev/maintenance-agent` branch; the
production branch was never touched (proven by `verify_branch_isolation.sql`).
