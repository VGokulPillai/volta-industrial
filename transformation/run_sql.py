#!/usr/bin/env python3
"""Run a delimited .sql file statement-by-statement on a SQL warehouse via the
SQL Statements API. Token comes from `databricks auth token -p <profile>`."""
import json, os, subprocess, sys, time, urllib.request, urllib.error

PROFILE = os.environ["PROFILE"]
HOST = os.environ["HOST"].rstrip("/")
WAREHOUSE = os.environ["WAREHOUSE_ID"]
CATALOG = os.environ["CATALOG"]
SCHEMA = os.environ["SCHEMA"]
SQL_FILE = sys.argv[1]

tok = json.loads(subprocess.check_output(
    ["databricks", "auth", "token", "-p", PROFILE]))["access_token"]

raw = open(SQL_FILE).read().replace("${CATALOG}", CATALOG).replace("${SCHEMA}", SCHEMA)
stmts = [s.strip() for s in raw.split("-- @@STATEMENT@@") if s.strip()]

def post(path, payload=None, method="POST"):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(HOST + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)

for i, stmt in enumerate(stmts, 1):
    first = " ".join(stmt.splitlines()[:3])[:80]
    print(f"[{i}/{len(stmts)}] {first} ...", flush=True)
    try:
        resp = post("/api/2.0/sql/statements", {
            "statement": stmt, "warehouse_id": WAREHOUSE,
            "wait_timeout": "50s", "on_wait_timeout": "CONTINUE",
            "disposition": "INLINE", "format": "JSON_ARRAY",
        })
    except urllib.error.HTTPError as e:
        print("  HTTP ERROR", e.code, e.read().decode()[:500]); sys.exit(1)
    sid = resp["statement_id"]
    state = resp["status"]["state"]
    while state in ("PENDING", "RUNNING"):
        time.sleep(2)
        resp = post(f"/api/2.0/sql/statements/{sid}", method="GET")
        state = resp["status"]["state"]
    if state != "SUCCEEDED":
        print("  FAILED:", json.dumps(resp["status"].get("error", {}))[:800]); sys.exit(1)
    data = resp.get("result", {}).get("data_array")
    if data:
        cols = [c["name"] for c in resp["manifest"]["schema"]["columns"]]
        for row in data[:20]:
            print("  ->", dict(zip(cols, row)))
    print("  SUCCEEDED", flush=True)

print("ALL STATEMENTS SUCCEEDED")
