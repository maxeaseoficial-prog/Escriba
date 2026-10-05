#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then
  echo "Instale primeiro: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg não encontrado. No macOS: brew install ffmpeg"
  exit 1
fi
exec .venv/bin/python -m uvicorn escriba.app:app --host 127.0.0.1 --port 8000 --workers 1
