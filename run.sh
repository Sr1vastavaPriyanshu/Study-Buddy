#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or is not on PATH." >&2
  echo "Install Node.js 22.5 or newer from https://nodejs.org/" >&2
  exit 1
fi

if ! node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=5)?0:1)"; then
  echo "Node.js 22.5 or newer is required." >&2
  exit 1
fi

if [ ! -f ".env" ]; then
  cp ".env.example" ".env"
  echo "Created .env from .env.example."
fi

if [ ! -d "backend/node_modules" ]; then
  echo "Installing backend dependencies..."
  (cd backend && npm install)
fi

echo "Starting Study Buddy..."
(cd backend && npm start) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

sleep 2
if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:3000"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:3000"
else
  echo "Open http://127.0.0.1:3000"
fi

wait "$SERVER_PID"
