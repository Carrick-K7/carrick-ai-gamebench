# GameBench 0.6 architecture

## Components

```text
apps/site           static task, methodology, and result pages
apps/reviewer       optional local human annotation UI
packages/core       task loading, strict schemas, hashing, and scoring
packages/evaluator  cagb doctor/bench/check/publish and Playwright evaluator
benchmark/starters  fresh Agent workspace
benchmark/tasks     four active Build contracts
benchmark/retired   inactive historical task packages
benchmark/releases  immutable release lock
results/lite        optional Git-reviewed flat result index
```

The runtime is Node.js 22, pnpm 10, TypeScript, and Playwright Chromium. It has no model-provider SDK, Docker daemon, verifier service, database, or application server.

## Data flow

```text
release lock + four task packages
             │
             ▼
real host preflight (install/build/preview/Chromium/bridge)
             │
             ▼
fresh task workspace → one Agent invocation
             │
             ▼
stop process tree → deterministic source archive + source hash
             │
             ▼
fresh materialization → one install/build/serve/browser evaluation
             │
             ▼
100-point task score
             │
             ├── repeat once for each of four tasks
             ▼
equal-weight Build mean → flat result.json → cagb check → optional Git publish
```

## Identity and layout

A run has one `series_id` used only as a directory and result identity. Each task row records:

- task id, version, and content hash;
- exactly one Agent invocation and its exit state;
- deterministic source archive hash;
- seed `104729` and evaluation status;
- complete ScoreResult test vector;
- artifact manifest hash.

The public contract is one `result.json`. Per-task directories hold source, logs, score, and failure evidence; they do not introduce Submission, Evaluation, Reproduction, Verification, or Publication protocol layers.

## Failure boundary

The preflight must succeed before any Agent call. During evaluation:

- contract and build-gate failures are model-delivery outcomes and are scored;
- unexpected host/runner exceptions are infrastructure errors and produce no score;
- an infrastructure evaluation may be attempted again with the identical archive;
- development is never retried automatically.

This separation prevents a missing package tarball or browser failure from becoming a model zero while preserving the one-attempt rule.

## Process and network boundary

Agent, install, build, preview, and browser processes run in detached process groups and are terminated as trees. Evaluator-owned commands receive an allowlisted environment without provider credentials. Browser contexts allow the assigned loopback origin and data URLs, and block WebSockets and service workers.

The generic Agent shell runs on the operator host and does not prove egress isolation. GameBench 0.6 records the harness configuration but does not make network-attestation claims.

## Integrity and publication

After all child processes and log streams close, the runner writes a per-task SHA-256 manifest. `cagb check` verifies those manifests, source archives, release identity, score arithmetic, exact four-task coverage, and the Build mean.

`cagb publish` performs the same check and updates the lightweight Git index. It does not rebuild, re-evaluate, call a verifier, or invoke Docker. Git review and immutable commits are the Official audit boundary.
