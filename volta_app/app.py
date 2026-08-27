"""
Volta Plant Floor — Predictive Maintenance (Databricks App, Streamlit).

Reads the live gold tables from the SQL warehouse and answers analytical "why"
questions via the Volta Genie space. Auth is the app's service principal
(Config() auto-detects DATABRICKS_CLIENT_ID/SECRET injected by Databricks Apps).
"""
import json
import os
import time

import pandas as pd
import streamlit as st
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

CATALOG = os.getenv("VOLTA_CATALOG", "serverless_stable_wx20co_catalog")
SCHEMA = os.getenv("VOLTA_SCHEMA", "dev_gokul_pillai_volta_industrial")
WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID", "")
GENIE_SPACE_ID = os.getenv("GENIE_SPACE_ID", "")
FQ = f"{CATALOG}.{SCHEMA}"

st.set_page_config(page_title="Volta Plant Floor", page_icon="⚙️", layout="wide")


@st.cache_resource
def get_client() -> WorkspaceClient:
    return WorkspaceClient()


def run_sql(query: str) -> pd.DataFrame:
    w = get_client()
    resp = w.statement_execution.execute_statement(
        statement=query, warehouse_id=WAREHOUSE_ID,
        catalog=CATALOG, schema=SCHEMA, wait_timeout="30s",
    )
    sid = resp.statement_id
    state = resp.status.state
    while state in (StatementState.PENDING, StatementState.RUNNING):
        time.sleep(1)
        resp = w.statement_execution.get_statement(sid)
        state = resp.status.state
    if state != StatementState.SUCCEEDED:
        msg = resp.status.error.message if resp.status and resp.status.error else "unknown error"
        raise RuntimeError(f"SQL failed: {msg}")
    cols = [c.name for c in resp.manifest.schema.columns]
    data = resp.result.data_array if resp.result and resp.result.data_array else []
    return pd.DataFrame(data, columns=cols)


@st.cache_data(ttl=120)
def load(query: str) -> pd.DataFrame:
    return run_sql(query)


def num(series):
    return pd.to_numeric(series, errors="coerce")


# ── Header ────────────────────────────────────────────────────────────────────
st.title("⚙️ Volta Plant Floor — Predictive Maintenance")
st.caption(
    "One connected experience: Lakebase operational state · gold analytics · Genie "
    "investigation · governed AI. Preventing unplanned downtime across 8 plants."
)

try:
    fleet = load(f"""
        SELECT plant_id, plant_name, line_id, line_name, machine_type,
               CAST(failure_risk_score AS DOUBLE) AS failure_risk_score,
               CAST(downtime_exposure_usd AS DOUBLE) AS downtime_exposure_usd,
               CAST(utilization_pct AS DOUBLE) AS utilization_pct,
               risk_band, current_status,
               CAST(open_wo_count AS INT) AS open_wo_count,
               has_open_corrective, part_local,
               CAST(plant_lat AS DOUBLE) AS lat, CAST(plant_lng AS DOUBLE) AS lon
        FROM {FQ}.gold_line_status
    """)
except Exception as e:
    st.error(
        "Couldn't read the gold tables. The app's service principal likely needs "
        f"SELECT on `{FQ}` and CAN USE on the SQL warehouse.\n\nDetails: {e}"
    )
    st.stop()

fleet["failure_risk_score"] = num(fleet["failure_risk_score"])
fleet["downtime_exposure_usd"] = num(fleet["downtime_exposure_usd"])
fleet["utilization_pct"] = num(fleet["utilization_pct"])

at_risk = fleet[fleet["risk_band"].isin(["critical", "elevated", "watch"])]
critical = fleet[fleet["risk_band"] == "critical"]

c1, c2, c3, c4 = st.columns(4)
c1.metric("Lines monitored", f"{len(fleet):,}")
c2.metric("At-risk lines", f"{len(at_risk):,}")
c3.metric("Critical lines", f"{len(critical):,}")
c4.metric("Downtime exposure", f"${fleet['downtime_exposure_usd'].sum()/1e6:,.1f}M")

tab_floor, tab_hero, tab_genie = st.tabs(
    ["🏭 Plant Floor", "🎯 LINE-04 (Hero)", "💬 Ask Genie"]
)

# ── Plant Floor ───────────────────────────────────────────────────────────────
with tab_floor:
    left, right = st.columns([3, 2])
    with left:
        st.subheader("At-risk lines — ranked by downtime exposure")
        show = at_risk.sort_values("downtime_exposure_usd", ascending=False)[
            ["line_id", "plant_name", "machine_type", "risk_band",
             "failure_risk_score", "downtime_exposure_usd", "open_wo_count", "part_local"]
        ].head(50)
        st.dataframe(
            show, use_container_width=True, hide_index=True,
            column_config={
                "failure_risk_score": st.column_config.ProgressColumn(
                    "risk", min_value=0.0, max_value=1.0, format="%.2f"),
                "downtime_exposure_usd": st.column_config.NumberColumn(
                    "exposure", format="$%.0f"),
            },
        )
    with right:
        st.subheader("Exposure by plant")
        by_plant = (
            at_risk.groupby("plant_name")["downtime_exposure_usd"].sum().sort_values(ascending=False)
        )
        st.bar_chart(by_plant)
        st.subheader("Fleet map (at-risk)")
        geo = at_risk.dropna(subset=["lat", "lon"])[["lat", "lon"]]
        if not geo.empty:
            st.map(geo, size=20)

    st.subheader("Risk vs utilization (the red cluster)")
    st.scatter_chart(
        fleet.dropna(subset=["utilization_pct", "failure_risk_score"]),
        x="utilization_pct", y="failure_risk_score", color="risk_band",
    )

# ── Hero: LINE-04 ─────────────────────────────────────────────────────────────
with tab_hero:
    st.subheader("LINE-04 @ PLANT-03 — the spotlight")
    hero = fleet[fleet["line_id"] == "LINE-0004"]
    if hero.empty:
        st.warning("LINE-0004 not found in gold_line_status.")
    else:
        h = hero.iloc[0]
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Failure risk", f"{h['failure_risk_score']:.2f}")
        m2.metric("Risk band", str(h["risk_band"]))
        m3.metric("Open work orders", int(h["open_wo_count"]))
        m4.metric("Part stocked locally", "No" if str(h["part_local"]).lower() in ("false", "0") else "Yes")

        try:
            rec = load(f"""
                SELECT recommended_action,
                       CAST(predicted_net_value_usd AS DOUBLE) AS predicted_net_value_usd,
                       action_ranking
                FROM {FQ}.gold_maintenance_recommendations
                WHERE line_id = 'LINE-0004'
            """)
            if not rec.empty:
                r = rec.iloc[0]
                st.success(
                    f"**Recommended action: `{r['recommended_action']}`** "
                    f"(net value ≈ ${float(r['predicted_net_value_usd']):,.0f})"
                )
                try:
                    options = json.loads(r["action_ranking"])
                    opt_df = pd.DataFrame(options)
                    st.markdown("**All candidate actions (ranked by net value):**")
                    st.dataframe(opt_df, use_container_width=True, hide_index=True)
                except Exception:
                    st.code(r["action_ranking"])
        except Exception as e:
            st.info(f"Recommendation unavailable: {e}")

        st.markdown(
            "> Telemetry is trending to failure **and** the replacement part isn't "
            "stocked locally — so an unplanned stop (downtime + expedite premium) "
            "costs more than pulling the line now. That's why **pull_now** wins."
        )

# ── Genie ─────────────────────────────────────────────────────────────────────
with tab_genie:
    st.subheader("Ask the data — Genie (natural language)")
    st.caption(f"Space: {GENIE_SPACE_ID or '(not configured)'}")
    examples = [
        "Which plant has the highest total downtime exposure?",
        "How many lines are in the critical risk band?",
        "What is the failure risk score for LINE-0004?",
    ]
    q = st.text_input("Your question", value=examples[0])
    cols = st.columns(len(examples))
    for i, ex in enumerate(examples):
        if cols[i].button(ex, key=f"ex{i}"):
            q = ex
    if st.button("Ask Genie", type="primary") and q and GENIE_SPACE_ID:
        with st.spinner("Genie is thinking…"):
            try:
                w = get_client()
                msg = w.genie.start_conversation_and_wait(GENIE_SPACE_ID, q)
                answered = False
                for att in (msg.attachments or []):
                    if getattr(att, "text", None) and att.text.content:
                        st.markdown(att.text.content)
                        answered = True
                    if getattr(att, "query", None):
                        qy = att.query
                        if getattr(qy, "description", None):
                            st.markdown(qy.description)
                        try:
                            res = w.genie.get_message_query_result(
                                GENIE_SPACE_ID, msg.conversation_id, msg.id)
                            sd = res.statement_response
                            if sd and sd.result and sd.result.data_array:
                                cols_ = [c.name for c in sd.manifest.schema.columns]
                                st.dataframe(pd.DataFrame(sd.result.data_array, columns=cols_),
                                             use_container_width=True, hide_index=True)
                                answered = True
                        except Exception:
                            if getattr(qy, "query", None):
                                st.code(qy.query, language="sql")
                if not answered and getattr(msg, "content", None):
                    st.markdown(msg.content)
            except Exception as e:
                st.error(f"Genie call failed (the app SP may need CAN RUN on the space): {e}")
