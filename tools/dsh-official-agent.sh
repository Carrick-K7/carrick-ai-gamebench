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

scratch=$(mktemp -d "${TMPDIR:-/tmp}/cagb-dsh-agent-XXXXXX")
codex_module=""
cleanup() {
  [[ -z "$codex_module" ]] || rm -f "$codex_module"
  rm -rf "$scratch"
}
trap cleanup EXIT

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
- id: tool-web
  disabled: true
EOF

case "$provider" in
  openai-codex)
    codex_plugin=/var/lib/deepseek-harness/.dsh/profiles/web/node_modules/dsh-codex-subscription
    codex_module="$codex_plugin/lib/cagb-headless-$$.js"
    node - "$codex_plugin/lib/index.js" "$codex_module" <<'NODE'
const fs = require("node:fs");
const [source, target] = process.argv.slice(2);
let text = fs.readFileSync(source, "utf8");
text = text.replace(
  /(const inject = \[\s*[\s\S]*?)\s*"connection",\s*\n/,
  "$1",
);
text = text.replace(
  /\s*ctx\.effect\(\(\) => ctx\.connection\.rpc\.handle\(CHANNEL, handler, \{ authority: "loopback" \}\), "codex-subscription: loopback account RPC"\);\s*\n/,
  "\n\tvoid handler;\n",
);
fs.writeFileSync(target, text);
NODE
    cat >>"$scratch/patch.yml" <<EOF
- insert:
    - id: codex-subscription-headless
      name: $codex_module
EOF
    ;;
  deepseek-official)
    cat >>"$scratch/patch.yml" <<'EOF'
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
EOF
    ;;
  *)
    echo "unsupported Official provider: $provider" >&2
    exit 64
    ;;
esac

export DSH_PERMISSION_MODE=workspace-write
dsh --profile headless --patch "$scratch/patch.yml" "$(<"$CAGB_PROMPT_PATH")"
