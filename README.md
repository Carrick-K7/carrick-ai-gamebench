# Carrick AI GameBench

Carrick AI GameBench has two independent suites: **Build — AI builds games**, and **Play — AI plays fixed games**. Version **0.7.0** adds the Play instrument and streamlines shared execution, validation and publication ([release notes](docs/releases/0.7.0.md)). It includes no new measured model results or deployment. Historical 0.6 results, scoring, hashes and URLs are unchanged ([0.6.1 notes](docs/releases/0.6.1.md)).

| Suite | Measured object | Ranking |
| --- | --- | --- |
| Build | One frozen coding-agent delivery per task | Equal-weight mean of four 100-point contracts |
| Play / 2048 | 10 fresh screenshot/native-input episodes, 200 decisions each | Mean native game score |
| Play / Minesweeper | 10 fresh 10×10/10-mine episodes, 128 decisions each | Win percentage |

There is **no combined Build/Play score and no Play total**. Play uses original maintainer-owned engines, not generated Build deliveries. `/play` has separate rankings and explicitly unranked browser practice.

## Build: unchanged instrument

A complete Build run uses four tasks:

- 2048 — discrete rules and keyboard input;
- Minesweeper — seeded hidden state and pointer input;
- 2D Parking — continuous motion, collision, and geometry;
- Six-player Texas Hold'em — betting state, hand ranking, all-ins, side pots, and chip conservation.

Each task gets exactly one Agent development invocation. The delivered source is frozen, unpacked into a new directory, and evaluated once at canonical seed `104729`. The Build score is the equal-weight mean of all four task scores. There is no Reproduce board, Core score, verifier, Docker requirement, or three-seed loop.

## Quick start

Requirements: Node.js 22.12+, pnpm 10.33.0, Chromium dependencies, `tar`, and `zstd`.

```bash
pnpm install --frozen-lockfile
pnpm --filter @carrick/gamebench exec playwright install --with-deps chromium
pnpm build
pnpm cagb doctor
pnpm cagb check
```

`doctor --suite build` exercises the real install/offline/build/browser path. `doctor --suite play` checks both reference games and the external no-tools Pi adapter without inference. Play needs separately installed Pi 0.84.3 and a configured vision-capable model; Core/Evaluator contain no provider SDK. See [Play operations](docs/play-operations.md) before starting a paid run.

After review, calibration and committing a new Campaign v2 under `benchmark/campaigns/0.7.0/`, run one preregistered Official Build cell (these commands are instructions, not permission to spend):

```bash
pnpm cagb bench \
  --campaign your-campaign-id \
  --cell your-cell-id
```

0.7.0 currently contains no measured Campaign or model results. Existing plans and results remain historical; do not relabel them or reuse their single-use cells.

Official identity, Pi invocation, model, provider, output path, and preallocated series ID come only from the committed campaign plan. Official runs require a clean Git tree. Free-form Agent commands are accepted only with `--local` while developing the runner or an adapter.

Validate the resulting flat record:

```bash
pnpm cagb check --run runs/0.7.0/<series-id>
```

After every campaign cell is complete, validate and publish the campaign as one batch:

```bash
pnpm cagb campaign check
pnpm cagb campaign publish --id your-campaign-id
```

## Why each step exists

1. **Release lock** — every model receives the same prompts, tests, scoring, seed, and task hashes.
2. **Real preflight** — host failures are found before model compute is spent.
3. **Fresh workspace/context** — avoid accidental carryover; this is not an OS sandbox or host attestation.
4. **One Agent invocation** — the attempt count and time limit match; tokens, inference compute, and cost need not.
5. **Frozen source archive** — the evaluated delivery cannot be silently repaired.
6. **Fresh evaluation directory** — the source must install, build, and run on its own.
7. **Public browser cases** — native input and schema-validated state produce objective points.
8. **Integrity check** — file hashes, score arithmetic, release identity, and coverage are rechecked without repeating the evaluation.
9. **Optional Git publication** — accepted results become reviewable and immutable in repository history.

Infrastructure errors do not become model zeroes. The evaluator may retry the same frozen `source_hash`, but it may never invoke the Agent again for that task. A real contract failure is scored normally and may be zero.

Official 0.6 means “project-operated canonical run committed by the maintainers.” It does not claim independent third-party reproduction.

## Task packages

Each active task lives under `benchmark/tasks/build/<game>/vN/` and owns its bilingual prompt, strict state schema, public browser cases, and 100-point manifest. The Build portion of `benchmark/releases/0.7.0.json` preserves the exact four-task catalog from 0.6.0/0.6.1. Original Play packages live under `benchmark/play/<game>/v1/`; the new lock freezes their source, resources and visual protocol separately.

See [methodology](docs/methodology.md), [0.6 design review](docs/benchmark-design-review.md), [architecture](docs/architecture.md), [campaign architecture](docs/campaign-architecture.md), [task authoring](docs/task-authoring.md), [results and publication](docs/results-and-publication.md), [versioning](docs/versioning.md), and the [Chinese README](README.zh-CN.md).

## Boundaries

- Machine contract evaluation is authoritative; optional human feedback never changes rank.
- Tests are public. This benchmark measures contract delivery, not creativity or fun.
- The CLI is provider-neutral and does not include provider SDKs.
- The public site is static; there is no database or public submission service.
- Generated workspaces and provider credentials are never committed.

## Licenses

Code is Apache-2.0. Original task text, documentation, media, and result data are CC BY 4.0.
