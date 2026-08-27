# Build 3 — Unity AI Gateway (Volta)

## WHAT THIS BUILD PROVES

Every **generative** AI call the Volta app makes is **bounded**, **visible**, and
**attributable** — directly addressing the $1,200 runaway-request incident where
the org saw a spike but couldn't explain it.

- **Bounded** — explicit QPM + TPM rate limits (service + per-user).
- **Visible** — usage tracking to `system.ai_gateway.usage`.
- **Attributable** — per-request tags (application / plant_id / feature / user_id).
- **Investigable** — inference request/response logging, joinable by request id.

Only the **generative** model calls are routed through the Gateway. Ordinary SQL /
Lakebase queries are NOT turned into LLM calls.

## ARCHITECTURE

```text
Volta App (agent brain)
    │  OpenAI/Responses call + Databricks-Ai-Gateway-Request-Tags header
    ▼
Unity AI Gateway (on the model serving endpoint)
    ├── rate limits (QPM/TPM, service + per-user)     → bounded
    ├── usage tracking → system.ai_gateway.usage       → visible + attributable
    ├── inference logging → <catalog>.<schema>.volta_ai_gateway_*  → investigable
    └── guardrails (PII/safety)
    ▼
Approved model (e.g. databricks-gpt-5-4 / gateway-fronted endpoint)
```

## PREREQUISITES

- A model serving endpoint used by the app's agent (`config/app.json` `agentModel`).
- Unity Catalog enabled (for `system.ai_gateway.usage` + inference tables).
- Permission to configure AI Gateway on the endpoint; SQL access to system tables.
- The app declares the `ai-gateway` OBO scope in `app/app.yaml` (already present).

## FILES

| Path | Purpose |
|---|---|
| `config/ai_gateway_config.json` | The Gateway config (usage tracking, inference logging, rate limits, guardrails). |
| `config/RATE_LIMIT_RATIONALE.md` | How the QPM/TPM limits are sized (8-plant rollout). |
| `config/apply_gateway_config.sh` | Applies the config via the serving-endpoints AI-gateway API. |
| `queries/executive_usage.sql` | Executive usage aggregations over `system.ai_gateway.usage`. |
| `queries/investigate_usage_spike.sql` | Incident-investigation query (window/user/endpoint/plant). |
| `tests/test_gateway_tags.py` | Small, safe control test: tagged requests + optional bounded burst. |
| `tests/README.md` | How to run + verify the control test safely. |
| `EXECUTIVE_REPORT.md` | The Head-of-AI report (bounded/visible/attributable/investigable). |
| `evidence/CAPTURE_REQUIRED.md` | Exact screenshots to capture. |

## HOW THE APP TAGS REQUESTS (the attributable mechanism)

`app/server/agent/plantfloor.ts` sets, on every model request:

```
Databricks-Ai-Gateway-Request-Tags: {
  "application": "volta-maintenance",
  "environment": "demo",
  "plant_id":    "PLANT-03",
  "feature":     "maintenance-assistant",
  "user_id":     "<OBO user email>"
}
```

These land in `system.ai_gateway.usage.request_tags` (a MAP), enabling the
attribution queries. No secrets/passwords/unsafe PII are included.

## HOW TO RUN

```bash
export DATABRICKS_HOST=https://<workspace-host>
export ENDPOINT_NAME=<agent model serving endpoint>
export DEMO_CATALOG=ai_demo_gen DEMO_SCHEMA=volta_industrial
bash config/apply_gateway_config.sh          # enable gateway controls
python3 tests/test_gateway_tags.py           # send tiny tagged requests
```

## HOW TO VALIDATE

```sql
-- After the control test (usage lands within minutes):
-- run queries/executive_usage.sql → non-zero requests/tokens, tags populated,
-- and a plant_id=PLANT-03 / line_id=LINE-04 attributable row.
-- run queries/investigate_usage_spike.sql over the test window → per-user rate +
-- request ids you can join to the inference log.
```

## EXPECTED RESULT

- Usage rows for `application='volta-maintenance'` with populated `request_tags`.
- The LINE-04 request attributable to PLANT-03 + user_id.
- (with `--burst`) some 429s once the cap trips → rate limit is enforced.

## EVIDENCE

- Machine-verifiable: `executive_usage.sql` / `investigate_usage_spike.sql` outputs
  + the control-test console output.
- Manual UI evidence: see `evidence/CAPTURE_REQUIRED.md` (Gateway config screen,
  usage query result, inference log row).

## ACCEPTANCE TEST

```text
[COMPLETE] application AI calls use governed model service .. app.yaml ai-gateway scope + agentModel endpoint
[COMPLETE] explicit rate limit exists ...................... config/ai_gateway_config.json (rate_limits)
[COMPLETE] token/request limit documented ................. config/RATE_LIMIT_RATIONALE.md
[COMPLETE] usage tracking enabled ......................... usage_tracking_config.enabled=true (apply script)
[COMPLETE] system.ai_gateway.usage query provided ......... queries/executive_usage.sql
[COMPLETE] request tags implemented ....................... plantfloor.ts Databricks-Ai-Gateway-Request-Tags
[COMPLETE] usage attributable to app/user/plant ........... request_tags aggregations
[COMPLETE] inference logging configured where supported ... inference_table_config.enabled=true
[COMPLETE] investigation query exists ..................... queries/investigate_usage_spike.sql
[COMPLETE] executive report exists ........................ EXECUTIVE_REPORT.md
[COMPLETE] $1,200 runaway-spend story directly addressed .. EXECUTIVE_REPORT.md (Incident → Outcome)
```
> "COMPLETE" here = the artifact/mechanism is implemented and self-contained.
> Live observed values (`<observed>`) + UI screenshots require running against the
> workspace — see `evidence/CAPTURE_REQUIRED.md`.
