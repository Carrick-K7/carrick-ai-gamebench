# Task authoring

## Minimal task

Create a directory below `benchmark/tasks/<track>/...` containing:

```text
task.yml
prompt.en.md
prompt.zh.md
state.schema.json
tests/cases.json
```

Reproduce tasks also require `THIRD_PARTY.yml`, a `reference/` capture page,
and licensed files under `references/`.

The runner copies the declared `bridge.state_schema`, complete public case
suite, and scored task manifest into every fresh submission workspace. Agent
harnesses can read their absolute locations from `CAGB_STATE_SCHEMA_PATH`,
`CAGB_PUBLIC_TESTS_PATH`, and `CAGB_TASK_MANIFEST_PATH`. The active execution
seed is available as `CAGB_SEED`.

Place the complete package at:

```text
benchmark/tasks/build/<game-slug>/vN/
benchmark/tasks/reproduce/<game-slug>/vN/
```

The evaluator discovers task packages recursively. New game genres therefore
do not require a central switch statement or evaluator registration.

Run:

```bash
pnpm build
pnpm cagb validate-task --all
```

## Manifest rules

- IDs are stable and end in `.vN`, where `N` equals the semantic version's
  major number.
- English is canonical and Chinese is a semantic mirror.
- Points total exactly 100.
- Each declared test references a case in `tests/cases.json`.
- Reproduce manifests pin an immutable 40-character upstream commit and
  declare its license.
- All referenced files are included in the task hash.

Any change that can affect scores requires a new task major version and a new
benchmark release. See [versioning](versioning.md).

## Case operations

Browser cases support:

- `reset`, `act`, and `advance` through the bridge;
- real `key` and `click` interaction;
- snapshot `expect` with exact, one-of, numeric, approximate, or active-run-seed
  comparison;
- deterministic `screenshot` with a normalized `max_diff_ratio`.

A `reset` step without an explicit seed receives the active run seed. Use an
explicit case seed only when a fixed reference capture or deterministic
fixture requires it. Active v2 tasks require `snapshot().seed` and include a
public `equals_run_seed` assertion; do not merely record the seed in run
metadata.

## Quality gate for a new task

Before release:

1. write an implementation that passes every case;
2. create focused mutants so every atomic test is observed failing;
3. run twice in clean evaluator environments and compare the test vector;
4. check real input and bridge state reach the same transition;
5. audit every third-party asset and record its provenance;
6. verify screenshot tolerances on the published Chromium image against the
   reference, a blank implementation, and representative deficient mutants;
7. freeze prompt, fixtures, tests, and image digest together.

Released active tasks live under `benchmark/tasks`. When a new major replaces
one, preserve the prior files under `benchmark/retired/<benchmark-version>/`
so the current branch remains readable without letting the catalog discover
both versions.
