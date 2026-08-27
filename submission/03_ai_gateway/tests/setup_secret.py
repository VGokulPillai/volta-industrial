#!/usr/bin/env python3
"""Create the `volta` secret scope and store a short-lived PAT used by the AI
Gateway proxy endpoint to reach the backing foundation model. The token value is
never printed."""
import json, os, subprocess, sys, tempfile

PROFILE = "fe-vm-serverless-stable-wx20co"

def run(args, inp=None):
    return subprocess.run(["databricks", *args, "-p", PROFILE],
                          capture_output=True, text=True, input=inp)

# 1) scope (idempotent)
r = run(["secrets", "create-scope", "volta"])
if r.returncode != 0 and "already exists" not in (r.stderr + r.stdout).lower():
    print("scope error:", r.stderr[:300]); sys.exit(1)
print("scope volta ready")

# 2) mint token (24h)
r = run(["tokens", "create", "--comment", "volta-ai-gateway", "--lifetime-seconds", "86400", "-o", "json"])
if r.returncode != 0:
    print("token error:", r.stderr[:300]); sys.exit(1)
tok = json.loads(r.stdout)["token_value"]

# 3) store secret (value written to a 0600 temp file, referenced via --json @file,
#    then deleted; never printed and never in argv)
fd, path = tempfile.mkstemp(suffix=".json")
try:
    os.chmod(path, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"scope": "volta", "key": "gw_token", "string_value": tok}, f)
    r = run(["secrets", "put-secret", "--json", "@" + path])
finally:
    os.remove(path)
if r.returncode != 0:
    print("put-secret error:", (r.stderr or r.stdout)[:300]); sys.exit(1)
print("secret volta/gw_token stored (len=%d)" % len(tok))
