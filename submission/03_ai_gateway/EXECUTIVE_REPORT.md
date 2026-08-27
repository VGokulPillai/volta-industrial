# Executive Report — Governing generative-AI spend at Volta

**Audience:** Head of AI. **Scope:** the Volta maintenance assistant's generative
AI calls, governed by Unity AI Gateway.

> Values marked `<observed>` are populated from live usage after running the
> control test and the queries in `queries/`. This report distinguishes **ACTUAL
> OBSERVED USAGE** from **ESTIMATED COST** and never invents a dollar figure.

## Incident

An employee accidentally allowed an AI-backed request to continue for ~2 hours.
Reported cost: **$1,200**. Tracing was insufficient — the org could see a usage
spike but could not explain **what happened**, **who caused it**, or **how to stop
a recurrence**.

## Previous risk

- No hard ceiling on request/token rate → a forgotten pattern could run unbounded.
- No per-request attribution → a spike could not be traced to a user/app/feature.
- No request/response logging → the actual prompt behind the spike was unknown.

## Controls implemented

### Bounded (rate limits)
Applied on the model serving endpoint (see `config/ai_gateway_config.json`,
rationale in `config/RATE_LIMIT_RATIONALE.md`):

| Scope | QPM (requests/min) | TPM (tokens/min, where supported) |
|---|---|---|
| Service (endpoint) | 300 | 2,000,000 |
| Per user | 60 | 400,000 |

A single forgotten request pattern is now capped per minute per user (and the
whole app is capped service-wide) → **a 2-hour runaway is impossible unbounded**;
it throttles (HTTP 429) at a known, alarmable rate.

### Visible (usage tracking)
`usage_tracking_config.enabled = true` → every generative call is logged to
`system.ai_gateway.usage`. Executive queries in `queries/executive_usage.sql`:

- AI requests: `<observed>` · Total tokens: `<observed>`
- Top users: `<observed>` · Top plants: `<observed>` · Top feature: `<observed>`
- Endpoint/model: `<observed>` · Spike hours: `<observed>`

### Attributable (request tags)
The app sends `Databricks-Ai-Gateway-Request-Tags` on every model call
(`app/server/agent/plantfloor.ts`): `application=volta-maintenance`,
`environment`, `plant_id`, `feature=maintenance-assistant`, `user_id` (OBO email).
Logged to `system.ai_gateway.usage.request_tags`. This answers, per request:
**who / which application / which plant / which feature.** The LINE-04 interaction
is attributable to `plant_id=PLANT-03` (control test proves it).

### Investigable (inference logging / tracing)
`inference_table_config.enabled = true` → request/response payloads are logged to
`${DEMO_CATALOG}.${DEMO_SCHEMA}.volta_ai_gateway_*`, joinable to usage by
`databricks_request_id`. `queries/investigate_usage_spike.sql` reconstructs any
window: request/token/latency by user, per-minute spike location, and the actual
prompt/response for the top offending requests.

- **Where logs live:** `system.ai_gateway.usage` (metrics + tags, 365-day
  retention) and the inference payload table in the demo catalog/schema.
- **Who should access:** account admins / authorised AI-governance operators only
  (payloads may contain sensitive prompt text) — governed by Unity Catalog grants;
  not exposed in the app UI.
- **How to investigate:** run `investigate_usage_spike.sql` with the time window +
  suspected user; join `databricks_request_id` to the payload table.
- **Retention/privacy:** usage table 365 days (regional); restrict payload table
  grants; PII guardrails block sensitive content at input/output.

## What happened / how much / who / could it recur / what prevents it

| Question | Answer |
|---|---|
| What happened? | Reconstructable from usage + inference logs for any window (`investigate_usage_spike.sql`). |
| How much was consumed? | `<observed>` requests / `<observed>` tokens (`executive_usage.sql`). |
| Who/what generated it? | Attributable by user / app / plant / feature via `request_tags`. |
| Could it happen again? | Not unbounded — per-user + service QPM/TPM caps throttle it. |
| What control now prevents uncontrolled spend? | Bounded rate limits + visible usage + attributable tags + investigable logs. |

## Outcome

Generative AI spend for the Volta maintenance assistant is now **bounded, visible,
and attributable**, with request/response **investigability** — the exact gaps the
$1,200 incident exposed are closed, and the same governance scales predictably
across the fleet of 8 plants.
