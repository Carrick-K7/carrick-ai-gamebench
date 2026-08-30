#!/usr/bin/env bash
set -euo pipefail

provider=${1:?provider required}
model=${2:?model required}
effort=${3:?reasoning effort required}

if [[ ! "$provider" =~ ^[a-zA-Z0-9._-]+$ ]] ||
  [[ ! "$model" =~ ^[a-zA-Z0-9._-]+$ ]] ||
  [[ ! "$effort" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "provider, model, and effort must use portable identifiers" >&2
  exit 64
fi

: "${CAGB_PROMPT_PATH:?CAGB_PROMPT_PATH is required}"

if [[ "$provider" == "openai-codex" ]]; then
  exec pnpm dlx @openai/codex@0.150.1 \
    exec \
    --ephemeral \
    --ignore-user-config \
    --ignore-rules \
    --skip-git-repo-check \
    --sandbox workspace-write \
    --model "$model" \
    -c "model_reasoning_effort=\"$effort\"" \
    -c 'shell_environment_policy.inherit="core"' \
    --json \
    - <"$CAGB_PROMPT_PATH"
fi

if [[ "$provider" != "deepseek-official" ]]; then
  echo "unsupported Official provider: $provider" >&2
  exit 64
fi

scratch=$(mktemp -d "${TMPDIR:-/tmp}/cagb-dsh-agent-XXXXXX")
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/settings.yaml" <<EOF
agent-default-model:
  provider: $provider
  model: $model
  reasoningEffort: $effort
EOF

cat >"$scratch/patch.yml" <<EOF
- id: settings
  config:
    path: $scratch/settings.yaml
    watch: false
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
EOF

export DSH_PERMISSION_MODE=workspace-write
exec dsh --profile headless --patch "$scratch/patch.yml" "$(<"$CAGB_PROMPT_PATH")"
