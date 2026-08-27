# Genie Space configuration — "Volta Plant Operations"

The app's `ask_data` tool (server/agent/tools/genie.ts) delegates natural-language
investigation to this Genie space. The agent calls it for **why / what-happened /
pattern** questions; deterministic operational reads (current stock, work-order
status, creating a work order) stay on direct Lakebase lookups (see
`../README.md` § Genie vs deterministic tools).

## Space

| Field | Value |
|---|---|
| Name | `Volta Plant Operations` |
| Purpose | Natural-language analytics over governed Volta manufacturing data. |
| App wiring | `GENIE_SPACE_ID` env → `config/app.json` `genieSpaceId` → registered as the `ask_data` tool. |
| App permission | `CAN RUN` (least required). Do NOT grant CAN MANAGE to the app principal. |

## Curated, governed datasets (grant ONLY these to the space)

Scope the space to the Gold analytical tables in Unity Catalog
(`${DEMO_CATALOG}.${DEMO_SCHEMA}`, default `ai_demo_gen.volta_industrial`):

- `gold_line_status` — production line health + failure risk + downtime exposure.
- `gold_open_atrisk` — lines at imminent risk + candidate part / locality.
- `gold_maintenance_recommendations` — ranked actions per line (pull_now / run / expedite).
- `raw_parts` — parts catalog (name, description, local stock, lead time, cost).
- (optional) `gold_maintenance_outcomes` — history for "what happened / patterns".

Do NOT grant the space write access or unrelated tables. Keep it read-only over
the curated analytical layer.

## Business definitions / instructions (paste into the space's instructions)

```text
- Unplanned downtime costs approximately $22,000 per hour. Expected unplanned
  stop duration is ~4 hours, so a single unplanned stop is ~$88,000.
- Risk bands, most to least severe: critical > elevated > watch > healthy.
- failure_risk_score is the model's predicted probability/risk (0–1) of an
  unplanned stop.
- LINE-04 is a production-line identifier; PLANT-03 is a plant identifier (Ohio).
- part_local = false means the replacement part is NOT immediately available at
  the plant and must be expedited (longer lead time, higher effective cost).
- downtime_exposure_usd is the dollar exposure a line represents if it stops.
- The three maintenance plays are: pull_now (planned maintenance now),
  run_to_shift_end (accept risk, run to shift end), expedite_parts_and_run
  (rush the part and keep running). expedite only nets positive when the part is
  local; for a high-risk non-local line (like LINE-04), pull_now typically wins.
```

## Sample questions (add as the space's suggested questions)

See `sample_questions.md`.

## Create / wire the space (CLI sketch)

```bash
# Create the space in the Databricks UI (Genie > New space) scoped to the tables
# above, OR via API. Then capture its space id and wire it to the app:
export GENIE_SPACE_ID=<the-space-id>      # → config/app.json genieSpaceId

# Grant the app's service principal CAN RUN on the space (least privilege).
# Databricks UI: Genie space > Share > add the app principal > Can Run.
```

> NOTE: the concrete Genie space id is a live resource. It is NOT hardcoded in
> this submission — it is provided via `GENIE_SPACE_ID`. Capture the created
> space id + permissions screenshot per `../evidence/CAPTURE_REQUIRED.md`.
