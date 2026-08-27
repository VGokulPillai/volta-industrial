# Control test — Build 3

`test_gateway_tags.py` sends a **small, safe** set of requests through the
AI-Gateway-governed model endpoint with the same request tags the Volta app uses,
so you can prove:

- requests appear in `system.ai_gateway.usage`,
- `request_tags` appear (application / plant_id / line_id / feature / user_id),
- the **LINE-04** request is attributable (plant_id=PLANT-03, line_id=LINE-04),
- (optional, `--burst N`) the rate limit is enforced — bounded, tiny prompts.

## Run

```bash
export DATABRICKS_HOST=https://<your-workspace-host>
export ENDPOINT_NAME=<ai-gateway-governed-serving-endpoint>
python3 test_gateway_tags.py            # 2 tiny tagged requests
python3 test_gateway_tags.py --burst 5  # tiny burst to probe rate limits (may 429)
```

## Safety

- `max_tokens=16` and 1-word prompts — negligible cost. This is a **control test,
  not a workload**. Do NOT increase token volume to "demonstrate throttling".
- The optional burst uses tiny prompts; a 429 is the *desired* proof that the cap
  is enforced.

## Verify

Wait a few minutes, then run the verification SQL printed by the script (or
`../queries/executive_usage.sql`). Capture the result per
`../evidence/CAPTURE_REQUIRED.md`.
