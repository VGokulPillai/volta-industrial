# Manual evidence to capture — Build 2 (Apps + Genie)

> Capture from the running app + Databricks UI. Do NOT fabricate. Save into this
> folder with the filenames below and update `../../connected_solution/EVIDENCE_MATRIX.md`.

## 1. Plant floor — `01_plant_floor.png`
```text
SCREENSHOT: the app's operational view showing the fleet with risk prioritisation.
MUST SHOW: at-risk lines with critical rising to the top; LINE-04 visible;
           KPIs (downtime exposure / critical lines / lines at risk / open WOs).
```

## 2. LINE-04 detail — `02_line04_detail.png`
```text
SCREENSHOT: LINE-04 detail (drawer/detail view).
MUST SHOW: PLANT-03, CNC mill, criticality; failure risk ≈ 87% CRITICAL;
           vibration + temperature; open corrective WO; required part
           (Coupling Seal Assembly) non-local + 14-day lead; downtime exposure.
```

## 3. Genie investigation — `03_genie_answer.png`
```text
SCREENSHOT: assistant answer to "Why is LINE-04 trending toward a stop?"
MUST SHOW: the Thinking panel with the ask_data (Genie) tool call + a synthesized
           answer citing rising vibration/temperature, risk 0.87, non-local part.
```

## 4. Ranked decision + draft — `04_ranked_decision.png`
```text
SCREENSHOT: assistant response after "Rank the action. Use the model."
MUST SHOW: all three options (pull_now / run_to_shift_end / expedite_parts_and_run)
           with predicted cost avoided / net value; PULL NOW recommended;
           the drafted work order; the CTA to approve.
```

## 5. Approval → live write — `05_approved_write.png`
```text
SCREENSHOT/RECORDING: after "Yes — pull the line now."
MUST SHOW: the queue/KPIs updating live (LINE-04 → Maintenance Scheduled),
           and the app.work_orders_app row (status=approved, approved_by=<you>).
CLI proof (optional): psql "$LAKEBASE_URL" -c
  "select id,line_id,action_type,status,approved_by from app.work_orders_app order by created_at desc limit 1;"
```

## 6. Genie space + permission — `06_genie_space.png`
```text
SCREENSHOT: Genie > Volta Plant Operations > (a) datasets scoped, (b) Share
           showing the app principal has CAN RUN (not CAN MANAGE).
```

## 7. MLflow trace — `07_mlflow_trace.png`
```text
SCREENSHOT: the MLflow trace for one hero turn showing per-tool spans
           (ask_data, find_atrisk_line, rank_maintenance_actions,
            execute_maintenance_action).
```
