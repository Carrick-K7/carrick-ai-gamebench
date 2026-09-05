# GameBench 0.6 methodology

## What is measured

GameBench measures whether a coding Agent can deliver playable browser games that follow public machine-checkable contracts. It does not score creativity, novelty, aesthetics, or fun. Optional human comments never change the machine score.

The 0.6 release has one Build leaderboard and four equally weighted tasks:

- 2048;
- Minesweeper;
- 2D Parking;
- Six-player no-limit Texas Hold'em.

## One development, one evaluation

For each task the runner:

1. creates a fresh development workspace from the pinned starter;
2. exposes the bilingual prompt, task manifest, public cases, and state schema;
3. invokes the Agent exactly once under the declared time budget;
4. stops the complete process tree at completion or timeout;
5. seals the delivered source into a deterministic archive and records its hash;
6. materializes that archive into a new evaluation directory;
7. installs, builds, serves, and evaluates it once with canonical seed `104729`.

A timeout is a delivery boundary, not an automatic failure: the code present at the deadline is frozen and evaluated. An Agent error is not retried.

The single physical evaluation contains many deterministic browser scenarios. Explicit fixture seeds cover random and edge conditions without repeating dependency installation, compilation, server startup, or the entire case suite.

## Preflight and failure ownership

Before any paid Agent call, `cagb doctor` proves that the actual host can:

- install and offline-reinstall the starter in a fresh temporary directory;
- build and preview it;
- launch Chromium;
- observe bridge version 1 and a valid snapshot;
- allocate ports and stop child process groups cleanly.

A task that enters the browser contract is scored normally. Build, serve, bridge, schema, mechanics, input, state, and stability failures belong to the delivery and may yield zero.

An unexpected host or runner exception is an `infrastructure-error`. It does not become a model score. The evaluator may retry the same frozen source once; it may not call the Agent again or modify the archive.

## Browser contract

Every game exposes `window.__CARRICK_GAMEBENCH__` bridge version 1 with `ready`, `reset`, `act`, `advance`, and `snapshot`. Cases combine bridge control with native keyboard and pointer input. Every observed snapshot must satisfy the task's JSON Schema and report the active seed.

The case suite and point allocation are public. Public tests make the score easy to understand and allow targeted implementation, so the benchmark's claim is deliberately narrow: contract delivery, not hidden generalization.

## Scoring

Each task declares exactly 100 points. A failed build-category test hard-gates that task to zero; otherwise points are the sum of passed atomic cases.

A complete Build result is:

```text
(2048 + Minesweeper + 2D Parking + Texas Hold'em) / 4
```

No task has a hidden weight. Time, token usage, cost, human review, and model reputation are not tie-breakers.

## Interpretation and uncertainty

- A series is **one observed delivery per task**, not an estimate of expected model performance. A single development sample cannot estimate run-to-run uncertainty or support significance claims about small score gaps.
- The four games are deliberately selected capability probes, not independent random samples of all game-development tasks. Their spread is not a confidence interval, and browser cases from one delivery are not independent model trials.
- One invocation and the same 3600-second deadline equalize the development opportunity, not token count, inference compute, tool use, or cost. The measured unit is the configured Agent/provider/model system.
- Equal task weights are transparent, not empirically calibrated difficulty weights. Read the per-task vector and hard-gate failures alongside the Build mean; a schema/build failure and many rule failures can produce the same zero.
- Public fixtures and schema-valid snapshots make outcomes auditable but do not prove that the visible game faithfully implements all rules. Native-input checks cover selected transitions; aesthetics, general gameplay completeness, and arbitrary-seed generalization remain outside the score's demonstrated coverage.
- Cross-Campaign differences are descriptive and can include provider, execution date, harness, and host-environment effects. Equal scores are ties, not evidence that the systems are equivalent.

A future reliability study should preregister additional independent development series and report every planned observation, including failures, rather than selecting the best run. Re-evaluating the same frozen source checks evaluator repeatability; it does not create another independent Agent sample. Any change to scored cases, gates, or aggregation belongs to a new benchmark release.

See the [0.6 design review](benchmark-design-review.md) for concrete coverage gaps and the optimization boundary.

## Result integrity

One flat `result.json` binds:

- benchmark release and Git commit;
- preregistered Campaign, provider, model, tracked Agent adapter, harness, and score-relevant parameters;
- one preallocated series identity and one Agent invocation per task;
- exact task and source hashes;
- canonical seed and machine score;
- artifact manifest hashes;
- four-task coverage and Build mean.

`cagb check` validates the release, source and artifact hashes, score arithmetic, task coverage, and Build mean without rebuilding or re-evaluating the games.

## Official meaning

Official 0.6 means that repository maintainers preregistered a Campaign Plan, ran each single-shot cell with the canonical runner from one clean Git commit, completed all four tasks per cell, passed `cagb check`, and batch-committed the flat results to the repository index. A one-cell Plan is an Official measurement rather than an internally controlled comparison; comparisons across separately committed Campaigns remain descriptive.

It does not claim independent third-party reproduction. GameBench 0.6 has no verifier, Docker image, network attestation, Reproduce board, Core composite, or mandatory human review.
