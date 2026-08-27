-- ============================================================================
-- Executive usage report — Unity AI Gateway
-- Engine: Databricks SQL. Source: system.ai_gateway.usage
-- Request tags are set by the app (Databricks-Ai-Gateway-Request-Tags header):
--   application, environment, plant_id, feature, user_id
-- Do NOT hardcode outputs — these queries return the live observed values.
-- ============================================================================

-- Reusable window: last 30 days of Volta maintenance-assistant traffic.
-- (Adjust the interval as needed.)

-- ── How many AI requests + how many tokens (headline) ────────────────────────
SELECT
    count(*)                    AS ai_requests,
    sum(total_tokens)           AS total_tokens,
    sum(input_token_count)      AS input_tokens,
    sum(output_token_count)     AS output_tokens
FROM system.ai_gateway.usage
WHERE request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND request_tags['application'] = 'volta-maintenance';

-- ── Which users generated the most usage ─────────────────────────────────────
SELECT
    request_tags['user_id'] AS user_id,
    count(*)                AS requests,
    sum(total_tokens)       AS total_tokens
FROM system.ai_gateway.usage
WHERE request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND request_tags['application'] = 'volta-maintenance'
GROUP BY request_tags['user_id']
ORDER BY total_tokens DESC;

-- ── Which plants generated the most usage ────────────────────────────────────
SELECT
    request_tags['plant_id'] AS plant_id,
    count(*)                 AS requests,
    sum(total_tokens)        AS total_tokens
FROM system.ai_gateway.usage
WHERE request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND request_tags['application'] = 'volta-maintenance'
GROUP BY request_tags['plant_id']
ORDER BY total_tokens DESC;

-- ── Which application feature generated the most usage ────────────────────────
SELECT
    request_tags['feature'] AS feature,
    count(*)                AS requests,
    sum(total_tokens)       AS total_tokens
FROM system.ai_gateway.usage
WHERE request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND request_tags['application'] = 'volta-maintenance'
GROUP BY request_tags['feature']
ORDER BY total_tokens DESC;

-- ── Which endpoint/model generated usage ─────────────────────────────────────
SELECT
    se.endpoint_name,
    se.served_entity_name,
    count(*)          AS requests,
    sum(u.total_tokens) AS total_tokens
FROM system.ai_gateway.usage u
LEFT JOIN system.serving.served_entities se
       ON se.served_entity_id = u.served_entity_id
WHERE u.request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND u.request_tags['application'] = 'volta-maintenance'
GROUP BY se.endpoint_name, se.served_entity_name
ORDER BY total_tokens DESC;

-- ── When did usage spike (hourly buckets) ────────────────────────────────────
SELECT
    date_trunc('HOUR', request_time) AS hour_bucket,
    count(*)                         AS requests,
    sum(total_tokens)                AS total_tokens
FROM system.ai_gateway.usage
WHERE request_time >= current_timestamp() - INTERVAL 7 DAYS
  AND request_tags['application'] = 'volta-maintenance'
GROUP BY date_trunc('HOUR', request_time)
ORDER BY hour_bucket;

-- ── Cross-tab: usage by plant × feature (the attribution grid) ───────────────
SELECT
    request_tags['plant_id'] AS plant_id,
    request_tags['feature']  AS feature,
    count(*)                 AS requests,
    sum(total_tokens)        AS total_tokens
FROM system.ai_gateway.usage
WHERE request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND request_tags['application'] = 'volta-maintenance'
GROUP BY request_tags['plant_id'], request_tags['feature']
ORDER BY total_tokens DESC;
