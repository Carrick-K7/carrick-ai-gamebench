# Carrick AI GameBench

Carrick AI GameBench (CAGB) is a reproducible benchmark for coding agents
building playable browser games. It measures two capabilities:

- **Build** a game from a frozen specification.
- **Reproduce** the mechanics, feel, and visuals of a licensed reference game.

The trusted machine score is based only on public, deterministic browser tests.
Human playtesting is reported separately through a blinded pairwise reviewer.

## Quick start

Requirements: Node.js 22.12+, pnpm 10, Docker, and Chromium dependencies.

```bash
pnpm install
pnpm build
pnpm cagb doctor
pnpm cagb list
pnpm cagb validate-task --all
```

The repository includes eight versioned tasks: six Build tasks and two
Reproduce tasks.

Run a local agent command against one task:

```bash
pnpm cagb run \
  --task build.2048.v1 \
  --agent-command './my-agent --prompt-file "$CAGB_PROMPT_PATH"' \
  --agent-id my-agent
```

Local runs default to one attempt. Add `--official` for three fresh attempts and
an audit-ready `official-candidate` series. This is not a self-attestation:
Official status is granted only when the publisher finds complete release
coverage and independent per-run verification.

Continue multiple tasks in the same series with `--series <ulid>`. The runner
stores immutable executions under `runs/<benchmark>/<series>/<run>/`.

Publish a scored v2 series as Experimental:

```bash
pnpm cagb publish \
  --series runs/0.2.0/<series-id> \
  --tier experimental \
  --objects .gamebench \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication
pnpm --filter @carrick/gamebench-site build
```

Build the pinned evaluator environment with:

```bash
pnpm docker:build
```

## Benchmark tracks

- Build: 2048, Minesweeper, 2D Parking, Tetris, Side-scroller Shooter, Tower Defense.
- Reproduce: OhSteem and Radius Raid.

See [methodology](docs/methodology.md), [architecture](docs/architecture.md),
[task authoring](docs/task-authoring.md), [versioning](docs/versioning.md),
[results and publication](docs/results-and-publication.md),
[deployment](docs/deployment.md),
[contributing](CONTRIBUTING.md), and the [Chinese README](README.zh-CN.md).

## Adding games

Each game is an independent directory under
`benchmark/tasks/<build|reproduce>/<game-slug>/vN/`. It owns its prompts,
state schema, test cases, and any licensed reference material, so adding a game
or version does not require modifying the evaluator.

Every benchmark release freezes the exact task IDs, semantic versions, and
content hashes in `benchmark/releases/<benchmark-version>.json`. Run
`pnpm cagb release-lock` to verify the current release or use `--write` only
after intentionally changing the benchmark version.

## Deliberate boundaries

- Tests are public. Official status comes from reproducible evidence and audit,
  not hidden tests.
- The shell adapter is provider-neutral and executes on the operator's host.
  It records the task network policy but does not itself provide an egress
  firewall. Reproduce runs must be performed by an operator-controlled harness
  that allows only the declared model API hosts.
- Machine scores use deterministic checks only. Human preference remains a
  separate blinded playtest result.
- The public site is static. Git stores audited result metadata and a
  content-addressed object root stores larger source, playable, and evidence
  artifacts. There is no database or public submission API.

## Licenses

Code is Apache-2.0. Original task text, documentation, media, and result data
are CC BY 4.0. Third-party material keeps its upstream license.
