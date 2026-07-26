# Versioning

CAGB versions the complete benchmark and each task independently.

## Benchmark releases

The root `package.json` version identifies the evaluator, task catalog, scoring
rules, and browser protocol released together. Website presentation and
non-methodological documentation use their Git commit as `site_build_id` and
do not alone require a benchmark release. Before publishing a release:

1. choose a new semantic benchmark version;
2. run `pnpm build`;
3. run `pnpm cagb release-lock --write`;
4. run `pnpm check`;
5. commit the generated `benchmark/releases/<version>.json`;
6. create the matching Git tag `v<version>`.

The v2 release lock records every task ID, task semantic version, track, and
SHA-256 content hash, plus run/publication protocols, score/aggregate schemas,
official seeds, and attempts per task. CI verifies that the current catalog
still matches it. Released lock files are append-only.

The result contracts have independent integer `schema_version` fields. Exact
execution is pinned again by release-lock hash, source Git commit, and evaluator
image digest. The site compares only equal `benchmark_version` values unless
the reader explicitly selects another release.

The 0.1.x release locks and run manifests remain readable. Run manifest v2 and
the publication ledger begin at benchmark v0.2.0; historical tags are never
rewritten.

Benchmark v0.3.0 activates the `.v2` task set. It makes the public case suite
available in the Agent workspace, verifies that games apply the active run
seed, uses image-area-relative visual tolerances, defines deadline snapshots,
and changes Core aggregation to equal track weighting. The unchanged `.v1`
task sources are retained under `benchmark/retired/0.2.0/`.

## Historical tag audit

`v0.2.0` was not tagged at the time of release. Repository history identifies
commit `ef3b6dc55afcd557a10813bf0b6148a76c9dd19c` as the atomic 0.2.0
change: its root and package versions are `0.2.0`, it introduces
`benchmark/releases/0.2.0.json`, and the retained v1 task sources resolve that
lock by exact content hash. This audit records the candidate commit but does
not create a retroactive tag. Tag creation remains an explicit governance
decision and must not move once issued.

## Task versions

A task ID ends in `.vN`, and `N` must equal the major component of the task's
`version` field. For example:

```text
build.2048.v1       version: 1.0.0
build.2048.v2       version: 2.0.0
```

Increment the task major version when a prompt, score weight, test, fixture,
reference capture, state schema, runtime, or network policy could change a
score. Keep the old task directory only when old releases must remain
executable from the same branch. Retired directories are excluded from active
catalog discovery; Git tags and release locks remain the authoritative
historical definition.

Patch versions are reserved for non-scoring metadata corrections. They still
require a new benchmark release lock so results always name an exact catalog.

## Adding games

Use a lowercase stable slug and keep the task self-contained:

```text
benchmark/tasks/
  build/<game-slug>/vN/
    task.yml
    prompt.en.md
    prompt.zh.md
    state.schema.json
    tests/cases.json
  reproduce/<game-slug>/vN/
    ...the same files...
    THIRD_PARTY.yml
    reference/
    references/
```

The catalog is discovered recursively and scored by track macro average.
Adding a game therefore expands coverage without changing existing game
weights: every task has equal weight within its track, while Build and
Reproduce each contribute 50% to Core.
