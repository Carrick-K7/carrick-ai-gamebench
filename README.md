# Carrick AI GameBench

Carrick AI GameBench 0.6 is a lightweight machine benchmark for coding agents that build playable browser games from public contracts.

A formal run uses four Build tasks:

- 2048 — discrete rules and keyboard input;
- Minesweeper — seeded hidden state and pointer input;
- 2D Parking — continuous motion, collision, and geometry;
- Six-player Texas Hold'em — betting state, hand ranking, all-ins, side pots, and chip conservation.

Each task gets exactly one Agent development invocation. The delivered source is frozen, unpacked into a new directory, and evaluated once at canonical seed `104729`. The Build score is the equal-weight mean of all four task scores. There is no Reproduce board, Core score, verifier, Docker requirement, or three-seed loop.

## Quick start

Requirements: Node.js 22.12+, pnpm 10.33.0, Chromium dependencies, `tar`, and `zstd`.

```bash
pnpm install
pnpm build
pnpm cagb doctor
pnpm cagb check
```

`doctor` performs a real temporary-directory install, offline reinstall, build, preview, Chromium launch, and bridge smoke before a paid Agent is called.

Run a complete model benchmark:

```bash
pnpm cagb bench \
  --agent-command './my-agent --prompt-file "$CAGB_PROMPT_PATH"' \
  --agent-id my-agent \
  --agent-version 1.0.0 \
  --model my-model \
  --model-params '{"reasoning_effort":"high"}' \
  --harness shell
```

Official runs require a clean Git tree. Use `--local` while developing the runner or an Agent adapter.

Validate the resulting flat record:

```bash
pnpm cagb check --run runs/0.6.0/<series-id>
```

Optionally publish a complete Official result to the Git result index:

```bash
pnpm cagb publish --run runs/0.6.0/<series-id>
```

## Why each step exists

1. **Release lock** — every model receives the same prompts, tests, scoring, seed, and task hashes.
2. **Real preflight** — host failures are found before model compute is spent.
3. **Fresh workspace** — tasks and models cannot inherit hidden files or state.
4. **One Agent invocation** — opportunity and compute remain comparable.
5. **Frozen source archive** — the evaluated delivery cannot be silently repaired.
6. **Fresh evaluation directory** — the source must install, build, and run on its own.
7. **Public browser cases** — native input and schema-validated state produce objective points.
8. **Integrity check** — file hashes, score arithmetic, release identity, and coverage are rechecked without repeating the evaluation.
9. **Optional Git publication** — accepted results become reviewable and immutable in repository history.

Infrastructure errors do not become model zeroes. The evaluator may retry the same frozen `source_hash`, but it may never invoke the Agent again for that task. A real contract failure is scored normally and may be zero.

Official 0.6 means “project-operated canonical run committed by the maintainers.” It does not claim independent third-party reproduction.

## Task packages

Each active task lives under `benchmark/tasks/build/<game>/vN/` and owns its bilingual prompt, strict state schema, public browser cases, and 100-point manifest. `benchmark/releases/0.6.0.json` freezes the exact four-task catalog.

See [methodology](docs/methodology.md), [architecture](docs/architecture.md), [task authoring](docs/task-authoring.md), [results and publication](docs/results-and-publication.md), [versioning](docs/versioning.md), and the [Chinese README](README.zh-CN.md).

## Boundaries

- Machine contract evaluation is authoritative; optional human feedback never changes rank.
- Tests are public. This benchmark measures contract delivery, not creativity or fun.
- The CLI is provider-neutral and does not include provider SDKs.
- The public site is static; there is no database or public submission service.
- Generated workspaces and provider credentials are never committed.

## Licenses

Code is Apache-2.0. Original task text, documentation, media, and result data are CC BY 4.0.
