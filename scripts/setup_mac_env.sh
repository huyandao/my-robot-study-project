#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v python3.11 >/dev/null 2>&1; then
  echo "python3.11 was not found. Install Python 3.11 first, then rerun this script."
  exit 1
fi

python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements-mac.txt

echo "Mac Python environment is ready."
echo "Activate it with: source .venv/bin/activate"

