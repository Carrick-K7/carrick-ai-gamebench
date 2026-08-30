# Architecture

## Repository components

```text
apps/site           static public result, game, source, and methodology site
apps/reviewer       local-only optional pairwise annotation UI
packages/core       schemas, catalog loading, hashing, scoring, evidence
packages/evaluator  cagb CLI, Agent runner, snapshot sealer, browser evaluator
packages/publisher  clean export, verification, object storage, result ledger
benchmark/starters  fresh Build/Reproduce development workspace
benchmark/tasks     versioned prompts, manifests, schemas, tests, references
benchmark/retired   preserved inactive task sources grouped by release
benchmark/releases  immutable catalog, protocol, board, and seed policy
results             small Git-reviewed public index and immutable manifests
```

Node.js 22, TypeScript, pnpm, and one Playwright browser stack keep the runtime
small. The CLI does not include model-provider SDKs.

## v0.5 data flow

```text
task manifest + starter + public state schema + public cases
          │
          ▼
one fresh development workspace ── prompt/env ──► one Agent invocation
          │
          ├──► development logs and usage
          ▼
stop Agent → sanitize evaluator transients → seal immutable source snapshot
          │
          ├──────────────┬──────────────┐
          ▼              ▼              ▼
fresh env seed A  fresh env seed B  fresh env seed C
install/build/serve/bridge/browser cases in every environment
          │              │              │
          └──────────────┴──────────────┘
                         ▼
        per-seed scores/evidence → task mean/deviation
                         ▼
         Build primary board + Reproduce independent report
                         ▼
clean reconstruction → verification → publication → static site
```

One task has one Agent invocation and one submission source snapshot. The three
fixed seeds are applied only while evaluating separately materialized copies of
that snapshot. Evaluation environments are fresh: dependency state, generated
files, browser storage, and server processes from one seed cannot affect
another.

Build workspaces install under the track's declared network policy. Reproduce
preparation and evaluation use the local pnpm store in offline mode where
required. Evaluator-owned install, build, preview, and browser processes receive
an explicit non-secret environment. Browser contexts allow requests only to the
assigned loopback origin and block WebSockets and service workers.

The Agent receives the state schema, public cases, and scored task manifest. A
v0.5 development input does not use one evaluation seed as a development
identity. The frozen game instead satisfies the bridge contract for arbitrary
reset seeds; the evaluator supplies each fixed seed after sealing.

## Public game contract

`task.yml` is validated by the strict `TaskManifestSchema`. Unknown keys,
missing files, duplicate test IDs, non-100 point totals, invalid case
references, and invalid snapshot schemas are rejected.

Games expose:

```ts
window.__CARRICK_GAMEBENCH__: {
  version: "1";
  ready: Promise<void>;
  reset({ seed, scenario? }): Promise<void>;
  act({ type, payload? }): Promise<void>;
  advance(ms: number): Promise<void>;
  snapshot(): Promise<{
    seed: number;
    status: "menu" | "running" | "paused" | "won" | "lost";
    tick: number;
    score?: number;
    state: object;
    events: object[];
  }>;
};
```

The bridge supplies deterministic observation and controlled time. It does not
replace UI testing: cases also send native keyboard, mouse, and select events.
The machine contract, not a human or model judge, determines the trusted score.

## Submission and evaluation identity

v0.5 separates development from evaluation:

- `series_id` identifies one benchmark batch.
- `submission_id` identifies one task's single Agent invocation and immutable
  source snapshot.
- `development_input_fingerprint` identifies the task, Agent configuration,
  prompt, budget, network policy, and other development inputs without an
  evaluation seed.
- `source_snapshot_hash` binds every evaluation to identical delivered bytes.
- `run_id` identifies one physical evaluation of that submission.
- the evaluation input fingerprint adds `submission_id`, evaluation seed,
  evaluator contract, and environment.

Equal fingerprints are reruns, not overwrites. A series records submissions and
evaluations separately. Official v0.5 data contains exactly one included
submission per required task and one included evaluation for each required seed
of that submission.

The old Run Manifest v1/v2 model remains readable. For v0.1-v0.4, one physical
run combined a fresh Agent development with one seed and had no parent
submission. Readers must not infer that those historical runs shared source.

## Scoring and publication boundaries

Per-seed checks produce immutable score and evidence records. Aggregation first
computes each submission's mean and population standard deviation across the
three seed evaluations, then macro-averages complete tasks within a board.
Build is the primary board; Reproduce is independent. v0.5 does not compute a
new ranked Core composite.

Official publication requires an operator to:

1. run the single Agent invocation under the declared network policy;
2. seal and identify the submission source snapshot;
3. materialize that snapshot freshly for all three evaluation seeds;
4. verify evidence and score identity for every evaluation;
5. rebuild the clean source in one digest-pinned evaluator image;
6. publish complete coverage for the board being qualified.

The current generic host shell adapter cannot prove egress isolation. That
control belongs to the official execution harness and is recorded as an
attestation.

The publisher exports only allowlisted project source, rejects unsafe links and
credential patterns, rebuilds without model credentials, scans generated
playables, and creates deterministic public artifacts. A stable presentation
seed may select the default cover, but all included seed evaluations remain
visible and the highest score is never selected for presentation.

Git stores `results/index.json` and immutable publication JSON. Large source
archives, playable directories, screenshots, and evidence use content-addressed
object storage. The static site reads only validated public data and never
scans `runs/`.

Human review summaries, when present, are optional annotations separated from
machine scoring and board qualification. Historical review schemas and the
local Reviewer remain supported but are not a required v0.5 component.

## Trust boundary

The trusted site and untrusted games use separate origins. Generated game
iframes have no main-site storage access and are served with restrictive CSP.
Raw trajectories, provider responses, complete traces, credentials, and private
votes stay outside the public result ledger.

## Future Creative benchmark

Creative evaluation will not be added as a third `build|reproduce` track. A
future Creative benchmark must have its own benchmark identity, release locks,
methodology, result index, qualification rules, and leaderboard. It may reuse
safe infrastructure types such as Agent identity and artifact storage without
sharing GameBench scores or coverage.
