-- ============================================================================
-- Incident investigation — Unity AI Gateway
-- Engine: Databricks SQL.
-- Purpose: reconstruct a hypothetical recurrence of the $1,200 runaway-request
--          incident — "we saw the spike but couldn't tell what the user asked."
--
-- Parameterize with Databricks SQL parameter markers (:name). Inputs:
--   :window_start, :window_end  (timestamps)
--   :user_id     (request_tags['user_id']; '' = any)
--   :endpoint    (served entity/endpoint name; '' = any)
--   :application (request_tags['application']; default volta-maintenance)
--   :plant_id    (request_tags['plant_id']; '' = any)
-- ============================================================================

-- ── 1. Attributed request/token/latency summary for the window ───────────────
SELECT
    request_tags['application'] AS application,
    request_tags['plant_id']    AS plant_id,
    request_tags['feature']     AS feature,
    request_tags['user_id']     AS user_id,
    count(*)                    AS request_count,
    sum(total_tokens)           AS total_tokens,
    avg(total_tokens)           AS avg_tokens_per_request,
    percentile(total_tokens, 0.95) AS p95_tokens
FROM system.ai_gateway.usage
WHERE request_time BETWEEN :window_start AND :window_end
  AND (:application = '' OR request_tags['application'] = :application)
  AND (:user_id    = '' OR request_tags['user_id']    = :user_id)
  AND (:plant_id   = '' OR request_tags['plant_id']   = :plant_id)
GROUP BY 1,2,3,4
ORDER BY total_tokens DESC;

-- ── 2. Locate the spike: per-minute request + token rate in the window ───────
SELECT
    date_trunc('MINUTE', request_time) AS minute_bucket,
    request_tags['user_id']            AS user_id,
    count(*)                           AS requests,
    sum(total_tokens)                  AS total_tokens
FROM system.ai_gateway.usage
WHERE request_time BETWEEN :window_start AND :window_end
  AND (:application = '' OR request_tags['application'] = :application)
  AND (:user_id    = '' OR request_tags['user_id']    = :user_id)
GROUP BY 1, 2
ORDER BY total_tokens DESC
LIMIT 50;

-- ── 3. Individual requests (attribution + latency + trace/log reference) ─────
-- databricks_request_id joins to the inference table (request/response payloads
-- from inference_table_config) so an authorised operator can see WHAT was asked.
SELECT
    request_time,
    request_tags['user_id']  AS user_id,
    request_tags['plant_id'] AS plant_id,
    request_tags['feature']  AS feature,
    requester,
    api_type,
    status_code,
    input_token_count,
    output_token_count,
    total_tokens,
    databricks_request_id      -- ← join key to the inference log table
FROM system.ai_gateway.usage
WHERE request_time BETWEEN :window_start AND :window_end
  AND (:user_id  = '' OR request_tags['user_id']  = :user_id)
  AND (:endpoint = '' OR served_entity_id IN (
        SELECT served_entity_id FROM system.serving.served_entities
        WHERE endpoint_name = :endpoint))
ORDER BY total_tokens DESC
LIMIT 200;

-- ── 4. Pull the actual prompt/response for the top offending requests ────────
-- Requires inference logging enabled (inference_table_config). Restrict access
-- to authorised operators only. Replace the table name with your prefix.
--   ${DEMO_CATALOG}.${DEMO_SCHEMA}.volta_ai_gateway_payload  (schema varies by workspace)
--
-- SELECT databricks_request_id, request, response, request_time
-- FROM ${DEMO_CATALOG}.${DEMO_SCHEMA}.volta_ai_gateway_payload
-- WHERE databricks_request_id IN ( /* ids from query 3 */ )
-- ORDER BY request_time;
