# Lakebase branch-based development workflow

## Branch tree

```text
production                     ← live operational state. NEVER experimented on.
    │  (child branch inherits an instant, isolated copy of production state)
    ▼
development                    ← integration branch. Validated migrations land here first.
    │  (child branch inherits development)
    ▼
dev/maintenance-agent          ← the coding agent's sandbox. Schema/data experiments ONLY here.
```

**Behaviour we rely on**

- `production` remains untouched during development.
- `development` inherits production state when branched.
- `dev/maintenance-agent` inherits its parent (`development`) state when branched.
- All schema/data experiments happen ONLY on `dev/maintenance-agent`.

Branch names can be adapted to workspace conventions; the *shape* (prod → dev →
agent, each an isolated inherited copy) is the point.

## Create the branches (Databricks CLI)

> Replace `{project-id}` with your Lakebase project id
> (`databricks postgres list-projects`). Exact subcommands may vary by CLI
> version — see `databricks postgres --help`.

```bash
# Parent (production is the project's default/primary branch).
databricks postgres list-branches projects/{project-id}

# Child development branch (inherits production state instantly).
databricks postgres create-branch projects/{project-id} \
  --name development --parent production

# Agent sandbox branch (inherits development).
databricks postgres create-branch projects/{project-id} \
  --name dev/maintenance-agent --parent development
```

Each branch exposes its own endpoint. Point the app / psql at a branch by using
that branch's endpoint (PGHOST / LAKEBASE_ENDPOINT). See the app's
`appkit.plugins.json` lakebase plugin for the endpoint resolution shape.

## The development lifecycle

1. **Branch** `dev/maintenance-agent` from `development` — instant isolated copy.
2. **Author** the change as a migration on the agent branch
   (`../migrations/002_maintenance_actions.sql`) — driven by `AGENT_PROMPT.md`.
3. **Validate** on the agent branch (`../queries/validate_migration.sql`).
4. **Prove isolation** — the change is present on the agent branch and ABSENT on
   production (`../queries/verify_branch_isolation.sql`).
5. **Promote** the SAME migration file → `development`, validate again.
6. **Promote** the SAME migration file → `production`, validate as the final gate.

## Promotion is migration-based (Lakebase does NOT auto-merge branches)

Database branches give you an **instant, isolated copy of production state to
develop against** — they are not a git-style merge. The validated change is
carried to production by **running the same migration file** in each environment,
in order:

```text
002_maintenance_actions.sql
    tested on : dev/maintenance-agent
    then run  : development
    finally   : production
```

This protects production from ad-hoc agent changes: only a reviewed, validated
migration is ever executed against production, and it is the identical artifact
that passed on the developer branch.
