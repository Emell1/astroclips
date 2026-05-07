#!/bin/bash
set -e
cd "$(dirname "$0")"

# Load env
if [ -f ../.env ]; then
  export $(grep -v '^#' ../.env | xargs)
fi

echo "Starting AstroClips processor on port 8000..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
