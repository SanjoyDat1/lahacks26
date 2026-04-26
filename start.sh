#!/usr/bin/env bash
# Start both the Next.js frontend and Python agent API together.
# Run from the repo root: ./start.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "▲ Starting Brian — full stack"
echo ""

# ── Agent API (port 8000) ─────────────────────────────────────────────────────
echo "  → Starting Python agent API on port 8000..."
cd "$REPO_ROOT/agent"
if ! command -v uv &>/dev/null; then
  echo "  ✗ 'uv' not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi
uv run brain-api &
AGENT_PID=$!
echo "  ✓ Agent API PID $AGENT_PID"

# ── Frontend (port 3000) ──────────────────────────────────────────────────────
echo "  → Starting Next.js frontend on port 3000..."
cd "$REPO_ROOT"
node_modules/.bin/next dev frontend --port 3000 &
NEXT_PID=$!
echo "  ✓ Frontend PID $NEXT_PID"

echo ""
echo "  Agent API:  http://localhost:8000/health"
echo "  Frontend:   http://localhost:3000"
echo "  Agent page: http://localhost:3000/agent"
echo ""
echo "  Press Ctrl+C to stop both servers."
echo ""

# Wait for either process to exit, then kill both
trap "kill $AGENT_PID $NEXT_PID 2>/dev/null; echo ''; echo 'Servers stopped.'" EXIT INT TERM
wait
