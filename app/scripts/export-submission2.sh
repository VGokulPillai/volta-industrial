#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(dirname "$APP_DIR")"
OUT_DIR="${1:-$REPO_DIR/submission2}"
FILES=(
  "package.json"
  "package-lock.json"
  "app.yaml"
  "server/db/schema.ts"
  "server/db/migrate.ts"
  "server/db/queries/maintenance.ts"
  "server/db/queries/chat.ts"
  "server/routes/operations.ts"
  "server/agent/plantfloor.ts"
  "server/chat-stream/index.ts"
  "client/src/shared/types.ts"
  "client/src/lib/plantfloor.ts"
  "client/src/operations/OperationsView.tsx"
  "scripts/build-app.sh"
)

mkdir -p "$OUT_DIR/app" "$OUT_DIR/evidence"
: > "$OUT_DIR/MANIFEST.sha256"

for relative in "${FILES[@]}"; do
  source="$APP_DIR/$relative"
  if [[ ! -f "$source" ]]; then
    echo "[submission2] missing required source: $relative" >&2
    exit 1
  fi
  destination="$OUT_DIR/app/$relative"
  mkdir -p "$(dirname "$destination")"
  cp "$source" "$destination"
  if command -v shasum >/dev/null 2>&1; then
    (cd "$OUT_DIR" && shasum -a 256 "app/$relative") >> "$OUT_DIR/MANIFEST.sha256"
  else
    (cd "$OUT_DIR" && sha256sum "app/$relative") >> "$OUT_DIR/MANIFEST.sha256"
  fi
done

# Live outputs are copied only when a caller explicitly supplies a capture
# directory. Missing captures remain missing; this script never manufactures
# screenshots, SQL results, deployment logs, IDs, or trace evidence.
if [[ -n "${SUBMISSION2_CAPTURE_DIR:-}" ]]; then
  for capture in \
    01_plant_floor.png \
    02_line04_detail.png \
    03_search_explanation.png \
    04_ranked_proposal.png \
    05_human_decision.png \
    06_closed_loop_read.json \
    07_mlflow_trace.png \
    08_deployment.json; do
    if [[ -f "$SUBMISSION2_CAPTURE_DIR/$capture" ]]; then
      cp "$SUBMISSION2_CAPTURE_DIR/$capture" "$OUT_DIR/evidence/$capture"
    else
      echo "[submission2] live capture not present (not fabricated): $capture"
    fi
  done
fi

echo "[submission2] exported source snapshot to $OUT_DIR"
