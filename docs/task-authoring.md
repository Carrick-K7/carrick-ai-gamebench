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
- snapshot `expect` with exact, one-of, numeric, or approximate comparison;
- deterministic `screenshot`.

## Quality gate for a new task

Before release:

1. write an implementation that passes every case;
2. create focused mutants so every atomic test is observed failing;
3. run twice in clean evaluator environments and compare the test vector;
4. check real input and bridge state reach the same transition;
5. audit every third-party asset and record its provenance;
6. verify screenshot tolerances on the published Chromium image;
7. freeze prompt, fixtures, tests, and image digest together.
