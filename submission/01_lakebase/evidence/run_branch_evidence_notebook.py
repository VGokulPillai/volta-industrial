# Databricks notebook source
# MAGIC %pip install -q psycopg2-binary

# COMMAND ----------

# Volta Industrial — Lakebase BRANCH-USAGE EXECUTION EVIDENCE
# Proves the two branch uses with real, isolated queries:
#   1) development iteration  -> dev-maintenance-agent (inherits prod, then a change
#                                that stays isolated from production)
#   2) throwaway forecasting  -> forecasting-what-if (a scratch what-if simulation
#                                that is discarded; production never sees it)
# Every step is a live SQL round-trip; the JSON summary is the committed artifact.
import json, urllib.request, psycopg2, psycopg2.extras

PROJECT = "volta-maintenance"
HOSTS = {
    "production":            "ep-steep-moon-d2x11wbr.database.us-east-1.cloud.databricks.com",
    "dev-maintenance-agent": "ep-weathered-hall-d23yaqbm.database.us-east-1.cloud.databricks.com",
    "forecasting-what-if":   "ep-shy-art-d2cqtbu2.database.us-east-1.cloud.databricks.com",
}
ENDPOINT = lambda br: f"projects/{PROJECT}/branches/{br}/endpoints/primary"

ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
API = ctx.apiUrl().get(); TOK = ctx.apiToken().get(); USER = ctx.userName().get()

def mint_cred(endpoint):
    req = urllib.request.Request(API + "/api/2.0/postgres/credentials",
        data=json.dumps({"endpoint": endpoint}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["token"]

def connect(branch):
    return psycopg2.connect(host=HOSTS[branch], port=5432, dbname="databricks_postgres",
                            user=USER, password=mint_cred(ENDPOINT(branch)), sslmode="require",
                            connect_timeout=30)

def q(conn, sql, args=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as c:
        c.execute(sql, args)
        try:
            return [dict(r) for r in c.fetchall()]
        except psycopg2.ProgrammingError:
            return []

def exec_(conn, sql, args=None):
    with conn.cursor() as c:
        c.execute(sql, args)

summary = {"connected_as": USER, "project": PROJECT, "endpoints": HOSTS}

# COMMAND ----------
# ── BASELINE on production ────────────────────────────────────────────────────
prod = connect("production"); prod.autocommit = True
base_wo   = q(prod, "SELECT count(*) AS n FROM app.work_orders")[0]["n"]
base_l04  = q(prod, "SELECT failure_risk_score FROM app.machine_state WHERE line_id='LINE-04'")[0]["failure_risk_score"]
summary["production_baseline"] = {"work_orders": base_wo, "line04_risk_score": base_l04}

# COMMAND ----------
# ── USE 1: development iteration on dev-maintenance-agent ─────────────────────
# The dev branch instantly inherits production state (copy-on-write), then we make
# an isolated change: add a new corrective work order for the hero line. This is
# the "coding agent iterates safely off main" workflow.
dev = connect("dev-maintenance-agent"); dev.autocommit = True
dev_inherited_wo = q(dev, "SELECT count(*) AS n FROM app.work_orders")[0]["n"]
exec_(dev, """
    INSERT INTO app.work_orders (work_order_id, line_id, status, action_type, description, required_part_id, created_by)
    VALUES ('WO-DEV-04','LINE-04','open','pull_now',
            'DEV BRANCH: agent-proposed proactive pull for LINE-04 spindle before failure.',
            'SEAL-040-VOLT','dev/maintenance-agent')
    ON CONFLICT (work_order_id) DO UPDATE SET updated_at = now()""")
dev_after_wo = q(dev, "SELECT count(*) AS n FROM app.work_orders")[0]["n"]
summary["use1_development_iteration"] = {
    "branch": "dev-maintenance-agent",
    "inherited_work_orders": dev_inherited_wo,
    "matches_production_baseline": dev_inherited_wo == base_wo,
    "work_orders_after_dev_change": dev_after_wo,
    "dev_only_row": q(dev, "SELECT work_order_id, line_id, action_type, created_by FROM app.work_orders WHERE work_order_id='WO-DEV-04'"),
}

# isolation check: production must NOT see the dev-only row
prod_sees_dev = q(prod, "SELECT count(*) AS n FROM app.work_orders WHERE work_order_id='WO-DEV-04'")[0]["n"]
prod_wo_now   = q(prod, "SELECT count(*) AS n FROM app.work_orders")[0]["n"]
summary["use1_isolation_proof"] = {
    "production_sees_dev_row": prod_sees_dev,          # expect 0
    "production_work_orders_unchanged": prod_wo_now == base_wo,
}

# COMMAND ----------
# ── USE 2: throwaway forecasting / what-if on forecasting-what-if ─────────────
# A scratch branch to answer "if we let LINE-04 run to failure, how many lines tip
# into 'critical'?" We mutate freely, read the answer, and discard the branch —
# production is never touched.
fc = connect("forecasting-what-if"); fc.autocommit = True
fc_before_critical = q(fc, "SELECT count(*) AS n FROM app.machine_state WHERE risk_band='critical'")[0]["n"]
# what-if: escalate every elevated line by +0.15 risk and reclassify
exec_(fc, """
    UPDATE app.machine_state
    SET failure_risk_score = LEAST(1.0, failure_risk_score + 0.15),
        risk_band = CASE WHEN LEAST(1.0, failure_risk_score + 0.15) >= 0.75 THEN 'critical'
                         WHEN LEAST(1.0, failure_risk_score + 0.15) >= 0.5  THEN 'elevated'
                         ELSE risk_band END
    WHERE risk_band IN ('elevated','watch')""")
fc_after_critical = q(fc, "SELECT count(*) AS n FROM app.machine_state WHERE risk_band='critical'")[0]["n"]
summary["use2_throwaway_forecasting"] = {
    "branch": "forecasting-what-if",
    "question": "If risk drifts up +0.15 across elevated/watch lines, how many lines become critical?",
    "critical_lines_before": fc_before_critical,
    "critical_lines_after_whatif": fc_after_critical,
    "whatif_top5": q(fc, """SELECT line_id, round(failure_risk_score::numeric,2) AS risk, risk_band
                            FROM app.machine_state ORDER BY failure_risk_score DESC LIMIT 5"""),
}
# isolation check: production critical count must be unchanged by the what-if
prod_critical = q(prod, "SELECT count(*) AS n FROM app.machine_state WHERE risk_band='critical'")[0]["n"]
summary["use2_isolation_proof"] = {
    "production_critical_lines": prod_critical,
    "production_line04_risk_unchanged": q(prod, "SELECT failure_risk_score FROM app.machine_state WHERE line_id='LINE-04'")[0]["failure_risk_score"] == base_l04,
}

# COMMAND ----------
# ── branch inventory (proves both branches exist and are READY) ───────────────
def list_branches():
    req = urllib.request.Request(API + f"/api/2.0/postgres/projects/{PROJECT}/branches",
        headers={"Authorization": "Bearer " + TOK})
    d = json.load(urllib.request.urlopen(req))
    out = []
    for b in (d.get("branches") or []):
        st = b.get("status", {})
        out.append({"name": b.get("name"), "state": st.get("current_state"),
                    "default": st.get("default"), "logical_size_bytes": st.get("logical_size_bytes")})
    return out
summary["branches"] = list_branches()

for c in (prod, dev, fc):
    c.close()

# COMMAND ----------
print(json.dumps(summary, indent=2, default=str))
dbutils.notebook.exit(json.dumps(summary, default=str))
