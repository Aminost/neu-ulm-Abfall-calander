#!/usr/bin/env bash
# Start CV Studio (macOS / Linux). First run installs everything into .venv
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "First start: installing (takes a minute)…"
  python3 -m venv .venv
fi
. .venv/bin/activate
pip install -q -r requirements.txt
python -m cvgen web
