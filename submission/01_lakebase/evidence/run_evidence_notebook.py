# Databricks notebook source
# MAGIC %pip install -q psycopg2-binary

# COMMAND ----------

# Volta Industrial — Lakebase EXECUTION EVIDENCE
# Runs on serverless. Mints a Lakebase credential in-workspace (no secret leaves
# Databricks), applies the coding-agent migration, validates it, answers the
# domain question, runs hybrid search, does a UC->Lakebase forward sync and a
# Lakebase->UC reverse sync with SCD Type 2 + system metadata columns, and
# creates dev + throwaway forecasting branches. Emits a JSON summary at the end.
import json, urllib.request, psycopg2, psycopg2.extras

CATALOG = "serverless_stable_wx20co_catalog"
SCHEMA  = "dev_gokul_pillai_volta_industrial"
PROJECT = "volta-maintenance"
PG_HOST = "ep-steep-moon-d2x11wbr.database.us-east-1.cloud.databricks.com"
ENDPOINT = f"projects/{PROJECT}/branches/production/endpoints/primary"

ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
API = ctx.apiUrl().get(); TOK = ctx.apiToken().get(); USER = ctx.userName().get()

def mint_cred(endpoint):
    req = urllib.request.Request(API + "/api/2.0/postgres/credentials",
        data=json.dumps({"endpoint": endpoint}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["token"]

conn = psycopg2.connect(host=PG_HOST, port=5432, dbname="databricks_postgres",
                        user=USER, password=mint_cred(ENDPOINT), sslmode="require")
conn.autocommit = True

def q(sql, args=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
        c.execute(sql, args)
        try:
            return [dict(r) for r in c.fetchall()]
        except psycopg2.ProgrammingError:
            return []

def exec_(sql):
    with conn.cursor() as c:
        c.execute(sql)

summary = {"catalog": CATALOG, "schema": SCHEMA, "connected_as": USER}

# COMMAND ----------
# ── AGENTIC DEV: apply the coding-agent migration (002) + capture schema diff ──
exec_("DROP TABLE IF EXISTS app.maintenance_actions CASCADE;")
before = q("""SELECT table_name FROM information_schema.tables
             WHERE table_schema='app' ORDER BY table_name""")
summary["schema_before"] = [r["table_name"] for r in before]

AGENT_MIGRATION_002 = r"""
BEGIN;
CREATE TABLE IF NOT EXISTS app.maintenance_actions (
    action_id        BIGSERIAL PRIMARY KEY,
    line_id          TEXT NOT NULL REFERENCES app.production_lines(line_id),
    evaluated_action TEXT NOT NULL
                     CHECK (evaluated_action IN ('pull_now','run_to_shift_end','expedite_parts_and_run')),
    action_cost_usd  NUMERIC(12,2),
    approval_status  TEXT NOT NULL DEFAULT 'proposed'
                     CHECK (approval_status IN ('proposed','approved','rejected','executed')),
    actor            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_actions_line_idx   ON app.maintenance_actions(line_id);
CREATE INDEX IF NOT EXISTS maintenance_actions_status_idx ON app.maintenance_actions(approval_status);
ALTER TABLE app.maintenance_actions ADD COLUMN IF NOT EXISTS expected_downtime_avoided_hours NUMERIC;
ALTER TABLE app.maintenance_actions ADD COLUMN IF NOT EXISTS estimated_net_value_usd NUMERIC;
INSERT INTO app.maintenance_actions
    (line_id, evaluated_action, action_cost_usd, expected_downtime_avoided_hours, estimated_net_value_usd, approval_status, actor)
VALUES
    ('LINE-04','pull_now',                8000.00, 4.0,  80000.00, 'proposed','dev/maintenance-agent'),
    ('LINE-04','run_to_shift_end',           0.00, 0.0, -75680.00, 'proposed','dev/maintenance-agent'),
    ('LINE-04','expedite_parts_and_run', 12000.00, 2.4,  40800.00, 'proposed','dev/maintenance-agent');
COMMIT;
"""
exec_(AGENT_MIGRATION_002)

after = q("""SELECT table_name FROM information_schema.tables
            WHERE table_schema='app' ORDER BY table_name""")
summary["schema_after"] = [r["table_name"] for r in after]
summary["agent_added_tables"] = sorted(set(summary["schema_after"]) - set(summary["schema_before"]))
summary["maintenance_actions_columns"] = q("""
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='app' AND table_name='maintenance_actions' ORDER BY ordinal_position""")

# ── validate the agent change: rank the actions, argmax net value ──
summary["agent_validation"] = q("""
    SELECT line_id, evaluated_action, action_cost_usd, estimated_net_value_usd, approval_status, actor
    FROM app.maintenance_actions WHERE line_id='LINE-04'
    ORDER BY estimated_net_value_usd DESC""")
summary["agent_validation_winner"] = q("""
    SELECT evaluated_action AS recommended, estimated_net_value_usd AS net_value_usd
    FROM app.maintenance_actions WHERE line_id='LINE-04'
    ORDER BY estimated_net_value_usd DESC LIMIT 1""")

# COMMAND ----------
# ── DOMAIN QUESTION (low-latency Lakebase join) ───────────────────────────────
# "Which at-risk line should we act on first, what's the recommended action, and
#  is the replacement part stocked locally?"
summary["domain_question"] = ("Which at-risk line should we act on first, what is the "
    "recommended action, and is the replacement part stocked locally?")
summary["domain_answer"] = q("""
    SELECT ms.line_id,
           pl.line_name,
           p.plant_name,
           ms.failure_risk_score,
           ms.risk_band,
           wo.action_type,
           pi.part_id,
           pi.part_local,
           pi.lead_time_days,
           ma.evaluated_action AS agent_recommended,
           ma.estimated_net_value_usd
    FROM app.machine_state ms
    JOIN app.production_lines pl ON pl.line_id = ms.line_id
    JOIN app.plants p           ON p.plant_id = pl.plant_id
    LEFT JOIN app.work_orders wo ON wo.line_id = ms.line_id AND wo.status='open'
    LEFT JOIN app.parts_inventory pi ON pi.part_id = wo.required_part_id
    LEFT JOIN LATERAL (
        SELECT evaluated_action, estimated_net_value_usd
        FROM app.maintenance_actions a WHERE a.line_id = ms.line_id
        ORDER BY estimated_net_value_usd DESC LIMIT 1
    ) ma ON true
    ORDER BY ms.failure_risk_score DESC
    LIMIT 5""")

# ── HYBRID SEARCH (full-text) returns relevant records for an NL query ────────
summary["search_query"] = "bearing vibration grinding noise"
summary["search_results"] = q("""
    SELECT note_id, line_id, technician_note,
           ts_rank(search_tsv, websearch_to_tsquery('english', %s)) AS rank
    FROM app.maintenance_notes
    WHERE search_tsv @@ websearch_to_tsquery('english', %s)
    ORDER BY rank DESC LIMIT 5""", ("bearing vibration grinding noise",) * 2)

# COMMAND ----------
# ── FORWARD SYNC: governed UC gold table -> Lakebase, returns rows ────────────
gold = spark.table(f"{CATALOG}.{SCHEMA}.gold_line_status") \
    .filter("risk_band in ('critical','elevated')") \
    .select("line_id","plant_id","plant_name","failure_risk_score",
            "downtime_exposure_usd","risk_band") \
    .orderBy("downtime_exposure_usd", ascending=False).limit(25)
rows = [(r["line_id"], r["plant_id"], r["plant_name"],
         float(r["failure_risk_score"]), float(r["downtime_exposure_usd"]), r["risk_band"])
        for r in gold.collect()]
exec_("""
    CREATE TABLE IF NOT EXISTS app.line_status_synced (
        line_id TEXT PRIMARY KEY, plant_id TEXT, plant_name TEXT,
        failure_risk_score DOUBLE PRECISION, downtime_exposure_usd NUMERIC,
        risk_band TEXT, synced_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
with conn.cursor() as c:
    psycopg2.extras.execute_values(c, """
        INSERT INTO app.line_status_synced
            (line_id,plant_id,plant_name,failure_risk_score,downtime_exposure_usd,risk_band)
        VALUES %s
        ON CONFLICT (line_id) DO UPDATE SET
            failure_risk_score=EXCLUDED.failure_risk_score,
            downtime_exposure_usd=EXCLUDED.downtime_exposure_usd,
            risk_band=EXCLUDED.risk_band, synced_at=now()""", rows)
summary["forward_sync_rowcount"] = q("SELECT count(*) AS n FROM app.line_status_synced")[0]["n"]
summary["forward_sync_sample"] = q("""
    SELECT line_id, plant_name, failure_risk_score, downtime_exposure_usd, risk_band
    FROM app.line_status_synced ORDER BY downtime_exposure_usd DESC LIMIT 5""")

# COMMAND ----------
# ── REVERSE SYNC: Lakebase writable table -> UC Delta with SCD Type 2 ─────────
TGT = f"{CATALOG}.{SCHEMA}.work_orders_history"
spark.sql(f"DROP TABLE IF EXISTS {TGT}")  # clean demo of the SCD2 lifecycle

def reverse_sync():
    src_rows = q("""SELECT work_order_id, line_id, status, action_type,
                           coalesce(description,'') AS description,
                           coalesce(required_part_id,'') AS required_part_id
                    FROM app.work_orders""")
    sdf = spark.createDataFrame(src_rows)
    sdf.createOrReplaceTempView("wo_src")
    if not spark.catalog.tableExists(TGT):
        spark.sql(f"""
            CREATE TABLE {TGT} (
                work_order_id STRING, line_id STRING, status STRING, action_type STRING,
                description STRING, required_part_id STRING,
                __is_current BOOLEAN, __start_at TIMESTAMP, __end_at TIMESTAMP,
                __synced_at TIMESTAMP, __source STRING
            ) USING DELTA""")
    spark.sql(f"""
        CREATE OR REPLACE TEMP VIEW staged AS
        SELECT s.work_order_id AS mergeKey, s.* FROM wo_src s
        UNION ALL
        SELECT NULL AS mergeKey, s.*
        FROM wo_src s JOIN {TGT} t
          ON t.work_order_id = s.work_order_id AND t.__is_current = true
        WHERE t.status <> s.status OR t.action_type <> s.action_type""")
    spark.sql(f"""
        MERGE INTO {TGT} t USING staged s
        ON t.work_order_id = s.mergeKey AND t.__is_current = true
        WHEN MATCHED AND (t.status <> s.status OR t.action_type <> s.action_type)
            THEN UPDATE SET t.__is_current = false, t.__end_at = current_timestamp()
        WHEN NOT MATCHED THEN INSERT
            (work_order_id, line_id, status, action_type, description, required_part_id,
             __is_current, __start_at, __end_at, __synced_at, __source)
            VALUES (s.work_order_id, s.line_id, s.status, s.action_type, s.description,
                    s.required_part_id, true, current_timestamp(), NULL,
                    current_timestamp(), 'lakebase:volta-maintenance/production')""")

reverse_sync()                                   # v1 — initial load (all current)
exec_("UPDATE app.work_orders SET status='approved', updated_at=now() WHERE work_order_id='WO-10004'")
reverse_sync()                                   # v2 — WO-10004 changed -> SCD2 history

hist = spark.sql(f"""
    SELECT work_order_id, status, __is_current, __start_at, __end_at, __synced_at, __source
    FROM {TGT} WHERE work_order_id='WO-10004' ORDER BY __start_at""").collect()
summary["reverse_sync_target"] = TGT
summary["reverse_sync_total_rows"] = spark.table(TGT).count()
summary["reverse_sync_scd2_history_WO_10004"] = [
    {k: (str(v) if v is not None else None) for k, v in r.asDict().items()} for r in hist]
summary["reverse_sync_metadata_columns"] = [f.name for f in spark.table(TGT).schema if f.name.startswith("__")]

# COMMAND ----------
# ── BRANCHING: dev iteration branch + throwaway forecasting branch ────────────
def create_branch(branch_id):
    url = API + f"/api/2.0/postgres/projects/{PROJECT}/branches?branch_id={branch_id}"
    for body in ({"no_expiry": True},
                 {"expire_time": "2027-12-31T00:00:00Z"},
                 {"ttl": "2592000s"}):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
            return {"branch_id": branch_id, "created": True, "body_used": body,
                    "resp_name": json.load(urllib.request.urlopen(req)).get("name")}
        except Exception as e:
            last = str(e)[:180]
    return {"branch_id": branch_id, "created": False, "error": last}

summary["branch_dev"] = create_branch("dev-maintenance-agent")
summary["branch_forecasting"] = create_branch("forecasting-what-if")
def list_branches():
    req = urllib.request.Request(API + f"/api/2.0/postgres/projects/{PROJECT}/branches",
        headers={"Authorization": "Bearer " + TOK})
    d = json.load(urllib.request.urlopen(req))
    return [b.get("name") for b in (d.get("branches") or [])]
summary["branches_after"] = list_branches()

# COMMAND ----------
conn.close()
print(json.dumps(summary, indent=2, default=str))
dbutils.notebook.exit(json.dumps(summary, default=str))
