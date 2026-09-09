#!/usr/bin/env bash
set -euo pipefail

bridge_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundled_python="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ -n "${DEEPTUTOR_PYTHON:-}" ]]; then
  workspace_python="${DEEPTUTOR_PYTHON}"
elif [[ -n "${PYTHON:-}" ]]; then
  workspace_python="${PYTHON}"
elif [[ -x "${bundled_python}" ]]; then
  workspace_python="${bundled_python}"
else
  workspace_python="python3"
fi

"${workspace_python}" -m pip install \
  --disable-pip-version-check \
  --target "${bridge_dir}/python_deps" \
  --requirement "${bridge_dir}/requirements.lock"
