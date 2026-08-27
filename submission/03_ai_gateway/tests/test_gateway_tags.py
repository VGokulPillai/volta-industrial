#!/usr/bin/env python3
"""
Deliberately (and cheaply) exercise the governed AI path so its usage, tags, and
attribution show up in system.ai_gateway.usage. Sends a SMALL, SAFE set of
requests through the AI-Gateway-governed model serving endpoint with the SAME
request tags the Volta app uses — including a LINE-04 request that must be
attributable.

This does NOT try to trigger throttling with large token volumes. To (optionally)
verify rate-limit behaviour safely, use --burst N to send N quick requests and
observe whether any return HTTP 429 (bounded, tiny prompts).

Env:
  DATABRICKS_HOST     e.g. https://adb-....azuredatabricks.net
  ENDPOINT_NAME       the AI-Gateway-governed serving endpoint (chat/responses)
  (auth uses `databricks auth token`)

Usage:
  python test_gateway_tags.py
  python test_gateway_tags.py --burst 5      # tiny burst to probe rate limits
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error

APP_TAGS_BASE = {
    "application": "volta-maintenance",
    "environment": "demo",
    "feature": "maintenance-assistant",
}


def _token(host: str) -> str:
    out = subprocess.check_output(["databricks", "auth", "token", "--host", host])
    return json.loads(out)["access_token"]


def _call(host: str, endpoint: str, token: str, tags: dict, prompt: str) -> int:
    url = f"{host}/serving-endpoints/{endpoint}/invocations"
    body = json.dumps(
        {
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 16,  # keep tiny — this is a control test, not a workload
        }
    ).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    # The mechanism under test: request tags → system.ai_gateway.usage.request_tags
    req.add_header("Databricks-Ai-Gateway-Request-Tags", json.dumps(tags))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--burst", type=int, default=0, help="send N tiny requests to probe rate limits")
    args = ap.parse_args()

    host = os.environ.get("DATABRICKS_HOST", "").rstrip("/")
    endpoint = os.environ.get("ENDPOINT_NAME", "")
    if not host or not endpoint:
        print("Set DATABRICKS_HOST and ENDPOINT_NAME", file=sys.stderr)
        return 2
    token = _token(host)

    # 1) One attributable LINE-04 request (must be findable in usage by plant_id/user_id).
    line04_tags = {**APP_TAGS_BASE, "plant_id": "PLANT-03", "line_id": "LINE-04", "user_id": "sam.ortiz@volta.example"}
    status = _call(host, endpoint, token, line04_tags, "One word: acknowledge.")
    print(f"[LINE-04 tagged request] HTTP {status}  tags={json.dumps(line04_tags)}")

    # 2) A second plant to show cross-plant attribution.
    p1_tags = {**APP_TAGS_BASE, "plant_id": "PLANT-01", "user_id": "lee.ops@volta.example"}
    status = _call(host, endpoint, token, p1_tags, "One word: acknowledge.")
    print(f"[PLANT-01 tagged request] HTTP {status}")

    # 3) Optional tiny burst to observe bounded behaviour (429 when the cap trips).
    if args.burst:
        codes = [_call(host, endpoint, token, line04_tags, "hi") for _ in range(args.burst)]
        throttled = sum(1 for c in codes if c == 429)
        print(f"[burst x{args.burst}] status codes={codes}  throttled(429)={throttled}")
        print("  (429s here demonstrate the rate limit is enforced — bounded by design.)")

    print(
        "\nNow verify in system.ai_gateway.usage (usage lands within ~minutes):\n"
        "  SELECT request_tags, count(*), sum(total_tokens)\n"
        "  FROM system.ai_gateway.usage\n"
        "  WHERE request_tags['application']='volta-maintenance'\n"
        "    AND request_time >= current_timestamp() - INTERVAL 1 HOUR\n"
        "  GROUP BY request_tags;\n"
        "Expect a row with plant_id=PLANT-03, line_id=LINE-04 (attributable)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
