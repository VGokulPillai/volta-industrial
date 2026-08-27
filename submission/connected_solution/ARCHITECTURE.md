# Connected Solution — Architecture

Volta Industrial runs ~8 plants. Unplanned downtime costs ~$22,000/hour;
across the org ~1,500 unplanned downtime hours/year ≈ **$33M/year**. Failures are
often visible in telemetry before the line stops. The hero question:

> **Line 4 is trending toward a stop. Pull it now or run it to the end of the shift?**

One sentence: **Lakebase holds the live operational state and supports safe
branch-based development, the Databricks App gives the plant manager a real-time
decision surface with Genie for investigation, and Unity AI Gateway prevents AI
usage from becoming an uncontrolled cost centre.**

## Diagram

```text
                    ┌───────────────────────────────┐
                    │       Databricks App          │
                    │    React + Node/FastAPI       │
   Plant Manager ──►│  Plant Floor + Maintenance AI │
                    └───────┬───────────────┬───────┘
                            │               │
                     operational      analytical / natural language
                            │               │
                            ▼               ▼
                     ┌──────────┐     ┌──────────────┐
                     │ Lakebase │     │ Genie Agent  │
                     │ Postgres │     │  + UC data   │
                     └──────────┘     └──────┬───────┘
                                             │ generative AI
                                             ▼
                                   ┌──────────────────┐
                                   │ Unity AI Gateway │
                                   │ bounded          │
                                   │ visible          │
                                   │ attributable     │
                                   └──────────────────┘
```

## Responsibilities

**Unity Catalog / analytical data** — the governed analytical foundation. Gold
tables (`gold_line_status`, `gold_open_atrisk`, `gold_maintenance_recommendations`,
`raw_parts`) live here; Genie and the SQL warehouse read them.

**Genie Agent ("Volta Plant Operations")** — natural-language analytical
investigation over the curated governed datasets ("why is LINE-04 trending toward
a stop?", "which at-risk lines also have parts shortages?"). Least-privilege
`CAN RUN` from the app.

**Lakebase** — low-latency operational application state: production lines +
machine state + parts + work orders + maintenance actions/notes; the app's single
write path (`work_orders_app` / `maintenance_actions`); hybrid search over
maintenance notes; and **safe database development branches** (production →
development → dev/maintenance-agent) with migration-based promotion.

**Databricks App** — the plant-manager decision + action interface. Shows live
line state + risk, runs the hero 3-phase chain (investigate via Genie → rank the
plays → draft → **human approval** → write to Lakebase), and keeps the view live
via the `dataMutated` cascade.

**Unity AI Gateway** — control + observability for the app's **generative** AI
calls: rate limits (bounded), usage tracking (visible), request tags (attributable
to app/plant/feature/user), and inference logging (investigable). SQL/Lakebase
reads are NOT routed through it.

## How the three builds connect (data flow of one decision)

1. App reads LINE-04 live state from **Lakebase** (operational).
2. Manager asks "why?" → app calls the **Genie Agent** over **Unity Catalog**
   analytical data; the model brain runs through **Unity AI Gateway** (tagged
   `plant_id=PLANT-03`, `line_id=LINE-04`, `feature=maintenance-assistant`).
3. App calls `rank_maintenance_actions` (Lakebase) → PULL NOW recommended.
4. Manager approves → app writes the work order back to **Lakebase**
   (`work_orders_app`), audited, and the floor view updates live.
5. That LINE-04 AI interaction is now findable in `system.ai_gateway.usage` by its
   tags — bounded, visible, attributable.

The operational schema behind step 4 was developed safely on an isolated
**Lakebase branch** and promoted by migration — production was never experimented
on.
