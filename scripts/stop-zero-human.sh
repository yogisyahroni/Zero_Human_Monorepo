#!/usr/bin/env bash
set -euo pipefail

docker compose -p zero-human down
echo "Stack stopped."
