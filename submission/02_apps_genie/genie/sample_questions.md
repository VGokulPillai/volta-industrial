# Genie sample questions — Volta Plant Operations

These are the suggested questions for the space. The first is the app's default
investigation prompt for the hero flow.

## Investigation (why / what-happened)

1. Why is LINE-04 trending toward a stop?
2. What telemetry signals changed for LINE-04 (vibration, temperature)?
3. Which lines have the highest failure risk right now, and why?
4. Which plants have the most downtime exposure?
5. Which at-risk lines also have a parts shortage (part not stocked locally)?
6. Which machine types are producing the most risk?
7. How much downtime cost could we avoid across all at-risk lines?
8. How many lines should we pull now vs. run vs. expedite?

## Expected shape of a good answer (for validation)

- Q1 "Why is LINE-04 trending toward a stop?" → cites rising vibration_rms +
  temperature_c, failure_risk_score ≈ 0.87 (critical), open corrective work order,
  and the non-local candidate part (SEAL-040-VOLT, 14-day lead) — i.e. an
  unplanned stop would be far costlier than a planned pull.
- Q5 "at-risk lines with parts shortages" → returns lines where
  failure_risk_score is high AND part_local = false (LINE-04 at the top).

## Genie SQL sanity (the analytical queries Genie should be able to generate)

```sql
-- Highest failure risk
SELECT line_id, plant_id, failure_risk_score, downtime_exposure_usd
FROM ${DEMO_CATALOG}.${DEMO_SCHEMA}.gold_line_status
ORDER BY failure_risk_score DESC LIMIT 10;

-- At-risk lines with a non-local part
SELECT line_id, plant_id, failure_risk_score, candidate_part_id, part_local, part_lead_time_days
FROM ${DEMO_CATALOG}.${DEMO_SCHEMA}.gold_open_atrisk
WHERE part_local = false
ORDER BY failure_risk_score DESC;

-- Downtime exposure by plant
SELECT plant_id, ROUND(SUM(downtime_exposure_usd)) AS exposure_usd
FROM ${DEMO_CATALOG}.${DEMO_SCHEMA}.gold_line_status
GROUP BY plant_id ORDER BY exposure_usd DESC;
```
