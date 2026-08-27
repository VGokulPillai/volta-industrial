SELECT 'fleet' AS check,
       count(*) AS total_lines,
       sum(CASE WHEN risk_band IN ('critical','elevated') THEN 1 ELSE 0 END) AS critical_elevated,
       sum(CASE WHEN has_open_corrective THEN 1 ELSE 0 END) AS open_corrective_lines,
       round(sum(downtime_exposure_usd)/1e6, 2) AS exposure_millions
FROM ${CATALOG}.${SCHEMA}.gold_line_status;

-- @@STATEMENT@@

SELECT recommended_action, count(*) AS n
FROM ${CATALOG}.${SCHEMA}.gold_maintenance_recommendations
GROUP BY recommended_action ORDER BY n DESC;

-- @@STATEMENT@@

SELECT line_id, recommended_action, predicted_net_value_usd
FROM ${CATALOG}.${SCHEMA}.gold_maintenance_recommendations
WHERE line_id = 'LINE-0004';
