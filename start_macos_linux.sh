#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${PROJECT_DIR}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python"

cd "${PROJECT_DIR}"

if [[ ! -x "${VENV_PYTHON}" ]]; then
  if command -v python3.11 >/dev/null 2>&1; then
    BOOTSTRAP_PYTHON="$(command -v python3.11)"
  elif command -v python3 >/dev/null 2>&1; then
    BOOTSTRAP_PYTHON="$(command -v python3)"
  else
    echo "Python 3.11 is required. Install it from https://www.python.org/downloads/" >&2
    exit 1
  fi

  "${BOOTSTRAP_PYTHON}" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else "Python 3.11 is required")'
  echo "Creating local virtual environment: ${VENV_DIR}"
  "${BOOTSTRAP_PYTHON}" -m venv "${VENV_DIR}"
fi

if ! "${VENV_PYTHON}" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)' >/dev/null 2>&1; then
  echo "The existing .venv is not Python 3.11. Delete .venv and run this script again." >&2
  exit 1
fi

if ! "${VENV_PYTHON}" -c 'from importlib.metadata import version; expected={"mujoco":"3.10.0","numpy":"2.4.6","pymycobot":"4.0.5","pyserial":"3.5"}; raise SystemExit(0 if all(version(name)==wanted for name,wanted in expected.items()) else 1)' >/dev/null 2>&1; then
  echo "Installing project dependencies..."
  "${VENV_PYTHON}" -m pip install --upgrade pip
  "${VENV_PYTHON}" -m pip install -r requirements.txt
fi

exec "${VENV_PYTHON}" run.py "$@"
