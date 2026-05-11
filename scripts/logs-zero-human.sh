#!/usr/bin/env bash
set -euo pipefail

follow="${1:-}"
if [ "$follow" = "-Follow" ] || [ "$follow" = "-f" ] || [ "$follow" = "--follow" ]; then
  docker compose -p zero-human logs -f
else
  docker compose -p zero-human logs --tail=100
fi
