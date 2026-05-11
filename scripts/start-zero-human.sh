#!/usr/bin/env bash
set -euo pipefail

echo "Starting Zero-Human stack..."
docker compose -p zero-human up -d --build
echo
echo "Stack started."
echo "  Zero-Human: http://localhost:3003"
echo "  9Router:    http://localhost:20128"
echo "  Paperclip:  http://localhost:3100"
