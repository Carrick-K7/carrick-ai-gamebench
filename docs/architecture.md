# Architecture

## Repository components

```text
apps/site           static public result, game, source, and methodology site
apps/reviewer       local-only blinded pairwise playtest UI
packages/core       schemas, catalog loading, hashing, scoring, evidence
packages/evaluator  cagb CLI, shell runner, Playwright evaluator, review server
packages/publisher  clean export, verification, object storage, result ledger
benchmark/starters  fresh Build/Reproduce workspace
benchmark/tasks     versioned prompts, manifests, schemas, tests, references
benchmark/releases  immutable task IDs, versions, and content hashes per release
results             small Git-reviewed public index and immutable manifests
```

Node.js 22, TypeScript, pnpm, and a single Playwright browser stack keep the
runtime small. The CLI does not include model-provider SDKs.

## Data flow

```text
task manifest + starter + public state schema
          │
          ▼
fresh workspace ── prompt/env ──► shell agent command
          │
          ├──► source.tar.zst + source.sha256
          ▼
frozen install → build → serve → bridge preflight → browser cases
          │
          ▼
tests.json → score.json → MANIFEST.sha256 → aggregate/reviewer
          │
          ▼
clean export → independent rebuild → content-addressed artifacts
          │
          ▼
publication manifest → results/index.json → static site
```

Build workspaces install from their lockfile with the track's declared network
policy. Reproduce preparation and evaluation use the local pnpm store in
offline mode. Runtime games must not depend on external network resources.
The task's declared state schema is copied into the fresh workspace at its
manifest-relative path and exposed through `CAGB_STATE_SCHEMA_PATH`.

## Public contracts

`task.yml` is validated by the strict `TaskManifestSchema`. Unknown keys,
missing files, duplicate test IDs, non-100 point totals, invalid test case
references, and invalid snapshot JSON Schemas are rejected.

Games expose:

```ts
window.__CARRICK_GAMEBENCH__: {
  version: "1";
  ready: Promise<void>;
  reset({ seed, scenario? }): Promise<void>;
  act({ type, payload? }): Promise<void>;
  advance(ms): Promise<void>;
  snapshot(): Promise<{
    status: "menu" | "running" | "paused" | "won" | "lost";
    tick: number;
    score?: number;
    state: object;
    events: object[];
  }>;
};
```

The bridge supplies deterministic observation and controlled time. It is not a
replacement for UI testing: task cases also send native keyboard, mouse, and
select events.

## Run identity and trust

Runs are grouped by a ULID `series_id`; every physical execution receives a
new ULID `run_id`. A deterministic `configuration_id` groups the same
benchmark/Agent/environment configuration, and `input_fingerprint` adds the
task and seed. Equal fingerprints are retained as reruns rather than
deduplicated.

`--official` means "produce an `official-candidate` with the three fixed
seeds"; it is not a local attestation of network isolation. Verification is a
separate immutable record and never a boolean written by the runner.

Official publication requires an operator to:

1. run the Agent in an egress-controlled environment;
2. allow only declared model API hosts for Reproduce tasks;
3. verify `MANIFEST.sha256`;
4. rebuild and reevaluate the source in the published evaluator image;
5. publish every release-task/seed cell and environment/image digest.

The current generic host shell adapter cannot distinguish a model API request
from source browsing, so it deliberately does not claim to enforce
`model-api-only`. That enforcement belongs to the official execution harness.

## Publication and storage

The raw run bundle is private audit material. The publisher exports only
allowlisted project source, rejects symlinks and credential patterns, rebuilds
without model credentials, and creates deterministic public artifacts.

Git stores `results/index.json` and immutable publication JSON. Large source
archives, playable directories, screenshots, and evidence use SHA-256 object
keys under `.gamebench/` locally or an equivalent static object root in
production. The public site reads only validated manifests at build time and
does not scan `runs/`.

The trusted site and untrusted games use separate origins. Generated game
iframes have no main-site storage access and are served with
`connect-src 'none'`.

## Failure behavior

- Dependency, build, serve, bridge, or initial snapshot failure hard-gates the
  task to zero.
- A browser case failure records a screenshot and Playwright trace.
- Agent timeout terminates the process group and is recorded separately from
  evaluation failure.
- Fresh workspaces copy only source inputs; `node_modules`, `dist`, and `.git`
  are excluded.
- Evidence manifests reject missing, changed, malformed, or escaping paths.
