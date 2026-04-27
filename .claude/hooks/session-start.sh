#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Verify Python 3 is available (required for dev server)
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found. Install Python 3 to run the dev server." >&2
  exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "python3 available: $PYTHON_VERSION"

# Start dev server in background on port 8000
cd "$CLAUDE_PROJECT_DIR"
fuser -k 8000/tcp 2>/dev/null || true
nohup python3 -m http.server 8000 > /tmp/finance-app-server.log 2>&1 &
echo "Dev server started on http://localhost:8000 (PID $!)"
