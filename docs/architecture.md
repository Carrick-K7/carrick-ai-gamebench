# Architecture

## Repository components

```text
apps/reviewer       local blinded pairwise playtest UI
packages/core       schemas, catalog loading, hashing, scoring, evidence
packages/evaluator  cagb CLI, shell runner, Playwright evaluator, review server
benchmark/starters  fresh Build/Reproduce workspace
benchmark/tasks     versioned prompts, manifests, schemas, tests, references
benchmark/releases  immutable task IDs, versions, and content hashes per release
results             public audited-result index
```

Node.js 22, TypeScript, pnpm, and a single Playwright browser stack keep the
runtime small. The CLI does not include model-provider SDKs.

## Data flow

```text
task manifest + starter
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
```

Build workspaces install from their lockfile with the track's declared network
policy. Reproduce preparation and evaluation use the local pnpm store in
offline mode. Runtime games must not depend on external network resources.

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

`--official` means "produce three audit-ready attempts"; it is not a local
attestation of network isolation. Every generated run starts with
`verified: false`.

Official publication requires an operator to:

1. run the Agent in an egress-controlled environment;
2. allow only declared model API hosts for Reproduce tasks;
3. verify `MANIFEST.sha256`;
4. rebuild and reevaluate the source in the published evaluator image;
5. publish the three attempts and environment/image digest.

The current generic host shell adapter cannot distinguish a model API request
from source browsing, so it deliberately does not claim to enforce
`model-api-only`. That enforcement belongs to the official execution harness.

## Failure behavior

- Dependency, build, serve, bridge, or initial snapshot failure hard-gates the
  task to zero.
- A browser case failure records a screenshot and Playwright trace.
- Agent timeout terminates the process group and is recorded separately from
  evaluation failure.
- Fresh workspaces copy only source inputs; `node_modules`, `dist`, and `.git`
  are excluded.
- Evidence manifests reject missing, changed, malformed, or escaping paths.
