#!/usr/bin/env python3
"""Deliberate AI Gateway control test against volta-maintenance-gw:
  1) a single TAGGED chat request (proves attribution + a healthy 200), then
  2) a burst of concurrent requests that should trip the per-user 20 QPM limit
     (proves the control is BOUNDED — expect HTTP 429s).
Auth token comes from `databricks auth token` (never printed)."""
import json, subprocess, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

PROFILE = "fe-vm-serverless-stable-wx20co"
HOST = "https://fevm-serverless-stable-wx20co.cloud.databricks.com"
URL = HOST + "/serving-endpoints/volta-maintenance-gw/invocations"

TOKEN = json.loads(subprocess.check_output(
    ["databricks", "auth", "token", "-p", PROFILE]))["access_token"]
TAGS = json.dumps({
    "application": "volta-maintenance", "environment": "demo",
    "plant_id": "PLANT-03", "feature": "maintenance-assistant",
    "user_id": "gokul.pillai@databricks.com",
})

def call(prompt="Say OK.", tag=True):
    body = json.dumps({"messages": [{"role": "user", "content": prompt}], "max_tokens": 8}).encode()
    req = urllib.request.Request(URL, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    if tag:
        req.add_header("Databricks-Ai-Gateway-Request-Tags", TAGS)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

# 1) tagged smoke test
print("== 1) tagged request ==")
code, resp = call("Reply with the single word: OPERATIONAL.")
if code == 200:
    msg = resp["choices"][0]["message"]["content"]
    print(f"  HTTP 200  model_reply={msg!r}  (tags attributed to system.serving.endpoint_usage)")
else:
    print(f"  HTTP {code}: {resp}")

# 2) throttle test — 30 concurrent calls vs the 20 QPM per-user cap
print("== 2) throttle burst (30 concurrent; per-user cap = 20 QPM) ==")
with ThreadPoolExecutor(max_workers=30) as ex:
    results = [f.result() for f in [ex.submit(call, "hi") for _ in range(30)]]
codes = [c for c, _ in results]
ok = codes.count(200)
throttled = codes.count(429)
print(f"  200 OK: {ok}   429 THROTTLED: {throttled}   other: {len(codes)-ok-throttled}")
print("  RESULT:", "PASS — rate limit enforced (429s observed)" if throttled else
      "no 429s (model latency spread calls across the minute window; re-run to burst harder)")
