# Manual evidence to capture — Build 1 (Lakebase)

> Do NOT fabricate these. Capture them from the live Lakebase UI after running
> the migrations + creating the branches. Save screenshots into THIS folder with
> the filenames below, then flip the matching STATUS in
> `../../connected_solution/EVIDENCE_MATRIX.md` to COMPLETE.

## 1. Branch list — `01_branch_list.png`

```text
SCREENSHOT:
  Lakebase > project (volta_operations) > Branches

MUST SHOW:
  - production
  - development       (child of production)
  - dev/maintenance-agent  (child of development)
```

## 2. Schema diff — `02_schema_diff.png`  (the headline isolation evidence)

```text
SCREENSHOT:
  Lakebase > project > dev/maintenance-agent > Schema diff (vs parent branch)

MUST SHOW:
  - the new app.maintenance_actions table
  - the columns expected_downtime_avoided_hours and estimated_net_value_usd
  - the parent branch comparison making clear the change is NOT on the parent
```

## 3. Isolation query outputs — `03_isolation_agent.png` + `04_isolation_prod.png`

```text
SCREENSHOT 03 (agent branch): running queries/verify_branch_isolation.sql
  MUST SHOW: maintenance_actions_exists = true, 2 enrichment cols, 3 LINE-04 rows

SCREENSHOT 04 (production branch): running queries/verify_branch_isolation.sql
  MUST SHOW: maintenance_actions_exists = false; production_lines_count = 8;
             LINE-04 still 0.87 / critical (production untouched)
```

## 4. Validation output — `05_validate_migration.png`

```text
SCREENSHOT: running queries/validate_migration.sql on the agent branch
  MUST SHOW: every check row reads "PASS: ..."
```

## 5. Hybrid search result — `06_hybrid_search.png`

```text
SCREENSHOT: running search/example_queries.sql
  MUST SHOW: NOTE-0001 (LINE-04 drive-side bearing vibration + grinding)
             ranked at/near the top for query "bearing vibration grinding"
```
