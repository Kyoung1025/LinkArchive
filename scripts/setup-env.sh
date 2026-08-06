#!/usr/bin/env bash
# Copies .env.example into each package that reads its own .env at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

for target in backend/shared/.env backend/api/.env backend/worker/.env; do
  if [ ! -f "$target" ]; then
    cp .env.example "$target"
    echo "created $target"
  else
    echo "skipped $target (already exists)"
  fi
done

if [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
  echo "created frontend/.env"
else
  echo "skipped frontend/.env (already exists)"
fi
