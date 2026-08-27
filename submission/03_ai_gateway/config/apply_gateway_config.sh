#!/usr/bin/env bash
# ============================================================================
# Apply Unity AI Gateway config to the Volta maintenance assistant's model
# serving endpoint. Enables usage tracking + inference logging + rate limits
# + guardrails. Idempotent (PUT replaces the endpoint's ai-gateway config).
# ============================================================================
set -euo pipefail

: "${DATABRICKS_HOST:?set DATABRICKS_HOST}"
: "${ENDPOINT_NAME:?set ENDPOINT_NAME (the agent model serving endpoint, e.g. databricks-gpt-5-4 or your gateway-fronted endpoint)}"
: "${DEMO_CATALOG:=ai_demo_gen}"
: "${DEMO_SCHEMA:=volta_industrial}"

TOKEN="$(databricks auth token --host "$DATABRICKS_HOST" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')"

# Calls-per-minute (QPM) rate limits + usage tracking + inference logging +
# guardrails. Token-per-minute limits are added separately where supported.
cat > /tmp/volta_ai_gateway.json <<JSON
{
  "usage_tracking_config": { "enabled": true },
  "inference_table_config": {
    "enabled": true,
    "catalog_name": "${DEMO_CATALOG}",
    "schema_name": "${DEMO_SCHEMA}",
    "table_name_prefix": "volta_ai_gateway"
  },
  "rate_limits": [
    { "key": "endpoint", "calls": 300, "renewal_period": "minute" },
    { "key": "user",     "calls": 60,  "renewal_period": "minute" }
  ],
  "guardrails": {
    "input":  { "pii": { "behavior": "BLOCK" }, "safety": true },
    "output": { "pii": { "behavior": "BLOCK" }, "safety": true }
  }
}
JSON

echo "Applying AI Gateway config to endpoint: ${ENDPOINT_NAME}"
curl -sS -X PUT \
  "${DATABRICKS_HOST}/api/2.0/serving-endpoints/${ENDPOINT_NAME}/ai-gateway" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/volta_ai_gateway.json | python3 -m json.tool

echo
echo "Done. Verify in the UI: Serving > ${ENDPOINT_NAME} > AI Gateway."
echo "Usage lands in system.ai_gateway.usage (request_tags column carries app tags)."
echo "Inference request/response logs land in ${DEMO_CATALOG}.${DEMO_SCHEMA}.volta_ai_gateway_*."
