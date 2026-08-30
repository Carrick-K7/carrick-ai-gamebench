# Carrick AI GameBench

Carrick AI GameBench (CAGB) is a reproducible benchmark for coding agents that
deliver playable browser games against public machine-checkable contracts.

- **Build** measures specification-to-game delivery and is the primary v0.5
  leaderboard.
- **Reproduce** measures mechanics, timing, interaction, and visual fidelity to
  licensed reference games. It is reported independently and does not affect
  Build rank.

The trusted score comes only from deterministic browser evaluation. Human
playtesting is an optional, non-scoring annotation. GameBench does not treat
Build as a creativity or fun score; a future Creative benchmark will have a
separate identity, methodology, release ledger, and leaderboard.

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
  --task build.2048.v2 \
  --agent-command './my-agent --prompt-file "$CAGB_PROMPT_PATH"' \
  --agent-id my-agent
```

Under the v0.5 protocol, one task receives exactly one Agent invocation and
produces one immutable submission source snapshot. After development stops,
the evaluator materializes that same snapshot into three fresh, isolated
environments and evaluates seeds `104729`, `130363`, and `155921`. Seeds are
evaluation conditions, not three development attempts, and the best seed is
never selected.

`--official` requests this complete fixed-seed evaluation and creates an
audit-ready `official-candidate` series. It is not self-attestation: Official
status still requires complete board coverage, clean-source reproduction, and
independent verification.

Continue multiple tasks in the same series with `--series <ulid>`. v0.5 keeps
the submission identity separate from each physical seed-evaluation `run_id`.
Local data remains under `runs/<benchmark>/<series>/`.

Publish a scored series as Experimental:

```bash
pnpm cagb publish \
  --series runs/0.5.0/<series-id> \
  --tier experimental \
  --board build \
  --objects .gamebench \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication --objects .gamebench
pnpm --filter @carrick/gamebench-site build
```

Build the pinned evaluator environment with:

```bash
pnpm docker:build
```

## Benchmark surfaces

- Build: 2048, Minesweeper, 2D Parking, Tetris, Side-scroller Shooter, and
  Tower Defense. Complete Build coverage produces the primary leaderboard
  score.
- Reproduce: OhSteem and Radius Raid. Reproduce has its own coverage and score,
  shown separately from Build.

See [methodology](docs/methodology.md), [architecture](docs/architecture.md),
[task authoring](docs/task-authoring.md), [versioning](docs/versioning.md),
[results and publication](docs/results-and-publication.md),
[result submission policy](docs/result-submissions.md),
[public site product design](docs/public-site.md),
[repository boundary ADR](docs/adr/0001-repository-boundaries.md),
[deployment](docs/deployment.md), [contributing](CONTRIBUTING.md), and the
[Chinese README](README.zh-CN.md).

## Adding games

Each game is an independent directory under
`benchmark/tasks/<build|reproduce>/<game-slug>/vN/`. It owns its prompts,
state schema, test cases, and any licensed reference material, so adding a game
or version does not require embedding game-specific logic in the evaluator.

The Agent receives the public case suite, scored manifest, and state contract.
The frozen submission must support arbitrary bridge reset seeds. Official
seeds are applied only after the source snapshot is sealed, while each fresh
evaluation environment runs the same public contract against the same bytes.

Every benchmark release freezes exact task IDs, semantic versions, content
hashes, protocol versions, board policy, and evaluation seeds in
`benchmark/releases/<benchmark-version>.json`. Run `pnpm cagb release-lock` to
verify the current lock or use `--write` only after intentionally changing the
benchmark version.

## Deliberate boundaries

- Tests are public. Official status comes from reproducible evidence and audit,
  not hidden tests, LLM judges, or VLM judges.
- Machine contract evaluation is authoritative. Human preference may be
  attached as an optional qualitative annotation and never changes rank.
- Build is the v0.5 primary board. Reproduce remains independently inspectable
  and cannot raise, lower, or break a Build leaderboard score.
- One Agent invocation creates one submission per task. All three seed scores
  come from fresh evaluations of the identical frozen source snapshot.
- The shell adapter is provider-neutral and executes on the operator's host. It
  records network policy but does not itself provide an egress firewall.
- The public site is static. Git stores audited result metadata and a
  content-addressed object root stores larger source, playable, and evidence
  artifacts. There is no database or public submission API.
- Public galleries expose every included seed evaluation and never cherry-pick
  the highest-scoring condition.
- Creativity, novelty, aesthetics, and fun are outside this benchmark's trusted
  score. A future Creative benchmark will be released separately rather than
  added as another GameBench track.

## Historical compatibility

v0.1-v0.4 remain immutable and retain their original meaning. In those
releases, an Official candidate used three fresh Agent development runs per
task, and historical aggregate schemas could publish a Core score combining
Build and Reproduce. Readers, release locks, result pages, and immutable
publication IDs for those versions remain valid; v0.5 does not reinterpret or
rerank them.

## Licenses

Code is Apache-2.0. Original task text, documentation, media, and result data
are CC BY 4.0. Third-party material keeps its upstream license.
