# Manual evidence to capture — Build 3 (AI Gateway)

> Capture after running `config/apply_gateway_config.sh` + `tests/test_gateway_tags.py`.
> Do NOT fabricate usage or cost values. Save into this folder; update
> `../../connected_solution/EVIDENCE_MATRIX.md`.

## 1. Gateway config — `01_gateway_config.png`
```text
SCREENSHOT: Serving > <endpoint> > AI Gateway
MUST SHOW: usage tracking ON, inference tables ON, rate limits (QPM; TPM where
           supported) for endpoint + user, guardrails ON.
```

## 2. Usage with tags — `02_usage_tags.png`
```text
SCREENSHOT: result of queries/executive_usage.sql (or the ad-hoc verify query)
MUST SHOW: non-zero requests/tokens for application='volta-maintenance' and a
           request_tags MAP with application/plant_id/feature/user_id populated.
```

## 3. LINE-04 attribution — `03_line04_attribution.png`
```text
SCREENSHOT: usage filtered to request_tags['line_id']='LINE-04' (or plant_id=PLANT-03)
MUST SHOW: the LINE-04 request row is attributable to plant + user + feature.
```

## 4. Spike investigation — `04_investigation.png`
```text
SCREENSHOT: result of queries/investigate_usage_spike.sql over the test window
MUST SHOW: per-user/per-minute request+token rate and databricks_request_id values.
```

## 5. Inference log row — `05_inference_log.png`
```text
SCREENSHOT: one row from the inference payload table
           (${DEMO_CATALOG}.${DEMO_SCHEMA}.volta_ai_gateway_*)
MUST SHOW: a request/response payload joinable by databricks_request_id — proving
           we can now answer "what did the user ask?" (the incident's missing piece).
ACCESS NOTE: restrict this table to authorised operators.
```

## 6. Rate-limit enforced (optional) — `06_rate_limit_429.png`
```text
SCREENSHOT/CONSOLE: tests/test_gateway_tags.py --burst N output showing 429(s)
MUST SHOW: bounded behaviour — the cap throttles once tripped (tiny prompts only).
```
