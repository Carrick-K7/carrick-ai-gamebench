#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: pi-gamebench.sh <provider> <model> <thinking>" >&2
  exit 64
fi

provider=$1
model=$2
thinking=$3

if [[ -n "${PI_BIN:-}" ]]; then
  pi_bin=$PI_BIN
else
  pi_bin=$(bash -lic 'command -v pi' 2>/dev/null || true)
fi
if [[ -z "$pi_bin" || ! -x "$pi_bin" ]]; then
  echo "Pi Agent executable was not found" >&2
  exit 69
fi
if [[ -z "${CAGB_PROMPT_PATH:-}" || ! -f "$CAGB_PROMPT_PATH" ]]; then
  echo "CAGB_PROMPT_PATH is unavailable" >&2
  exit 66
fi

exec "$pi_bin" \
  --provider "$provider" \
  --model "$model" \
  --thinking "$thinking" \
  --print \
  --no-session \
  --no-context-files \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-approve \
  "$(cat "$CAGB_PROMPT_PATH")"
