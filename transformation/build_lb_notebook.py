#!/usr/bin/env python3
"""Generate a Databricks notebook that applies the Lakebase operational
migration from *inside* the workspace (serverless). The credential is minted in
the notebook via /api/2.0/postgres/credentials, so no secret leaves Databricks."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
sql_001 = (ROOT / "submission/01_lakebase/migrations/001_operational_schema.sql").read_text()

# Tier-1 portable full-text search (from search/setup_search.sql)
sql_search = """
ALTER TABLE app.maintenance_notes
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(technician_note, '') || ' ' || coalesce(machine_type, ''))
    ) STORED;
CREATE INDEX IF NOT EXISTS maintenance_notes_tsv_idx
    ON app.maintenance_notes USING GIN (search_tsv);
"""

ENDPOINT = "projects/volta-maintenance/branches/production/endpoints/primary"
PG_HOST = "ep-steep-moon-d2x11wbr.database.us-east-1.cloud.databricks.com"

nb = f'''# Databricks notebook source
# MAGIC %pip install -q psycopg2-binary

# COMMAND ----------

import json, urllib.request, psycopg2

ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
api_host = ctx.apiUrl().get()
api_token = ctx.apiToken().get()
user = ctx.userName().get()

req = urllib.request.Request(
    api_host + "/api/2.0/postgres/credentials",
    data=json.dumps({{"endpoint": "{ENDPOINT}"}}).encode(),
    method="POST",
    headers={{"Authorization": "Bearer " + api_token, "Content-Type": "application/json"}},
)
cred = json.load(urllib.request.urlopen(req))
pg_token = cred["token"]
print("minted credential; connecting as", user)

conn = psycopg2.connect(
    host="{PG_HOST}", port=5432, dbname="databricks_postgres",
    user=user, password=pg_token, sslmode="require",
)
conn.autocommit = True
cur = conn.cursor()

# COMMAND ----------

SCHEMA_SQL = r"""{sql_001}"""
SEARCH_SQL = r"""{sql_search}"""

cur.execute(SCHEMA_SQL)
print("migration 001 applied")
cur.execute(SEARCH_SQL)
print("tier-1 search index applied")

# COMMAND ----------

summary = {{}}
for t in ["plants", "production_lines", "machine_state", "parts_inventory", "work_orders", "maintenance_notes"]:
    cur.execute(f"select count(*) from app.{{t}}")
    summary[t] = cur.fetchone()[0]
    print(f"app.{{t}}:", summary[t])

cur.execute("select line_id, failure_risk_score, risk_band from app.machine_state where line_id='LINE-04'")
hero = cur.fetchone()
summary["hero_line"] = list(hero) if hero else None
print("HERO:", hero)

# Native hybrid keyword search demo over maintenance_notes (Tier 1 FTS)
cur.execute("""
    select note_id, line_id,
           ts_rank(search_tsv, websearch_to_tsquery('english','bearing vibration')) as rank
    from app.maintenance_notes
    where search_tsv @@ websearch_to_tsquery('english','bearing vibration')
    order by rank desc limit 5
""")
print("SEARCH 'bearing vibration':")
for r in cur.fetchall():
    print("  ", r)
    summary.setdefault("search_hits", []).append(list(r))

conn.close()
print("DONE")
dbutils.notebook.exit(json.dumps(summary, default=str))
'''

out = ROOT / "transformation/lakebase_migrate_notebook.py"
out.write_text(nb)
print("wrote", out)
