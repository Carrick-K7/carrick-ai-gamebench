# Task authoring

GameBench 0.6 discovers active tasks below `benchmark/tasks/build/`. A task package contains:

```text
benchmark/tasks/build/<game-slug>/vN/
  task.yml
  prompt.en.md
  prompt.zh.md
  state.schema.json
  tests/cases.json
```

The runner copies the complete public contract into each fresh Agent workspace. Harnesses receive:

- `CAGB_PROMPT_PATH`;
- `CAGB_STATE_SCHEMA_PATH`;
- `CAGB_PUBLIC_TESTS_PATH`;
- `CAGB_TASK_MANIFEST_PATH`.

Evaluation seed is deliberately not a development identity. Games must support the bridge reset contract for the seed supplied after source freezing.

## Manifest rules

- IDs are stable and begin with `build.`.
- IDs end in `.vN`, where `N` equals the semantic task major.
- English is canonical and Chinese is a semantic mirror.
- Atomic points total exactly 100.
- Scored tests and cases in `tests/cases.json` have a one-to-one mapping: no shared or unscored cases.
- Case IDs are unique lowercase slugs (`[a-z0-9][a-z0-9._-]*`) because they also name evidence directories.
- Only the build-category test may reference a `kind: build` case; all other scored tests reference browser cases.
- Every browser case has at least one `expect` or screenshot assertion; actions alone cannot earn points.
- Every task includes a `run-seed` browser case that resets with the active seed and checks `snapshot.seed`.
- Paths are relative, portable, and cannot escape the package.
- Every task file contributes to the content hash.

Unknown fields, duplicate tests, invalid paths, score totals other than 100, and schema-invalid cases are rejected.

## Browser cases

Cases may use:

- bridge `reset`, `act`, and `advance` operations;
- native keyboard and pointer operations;
- state expectations with exact, one-of, numeric, approximate, or active-seed comparisons;
- deterministic screenshot comparison when visual pixels are an explicit contract.

Use explicit fixture seeds for deterministic scenarios inside the one canonical evaluation. `equals_run_seed` means the canonical evaluation seed, not the last explicit fixture seed; use `equals: <fixture-seed>` to check a reset with a different fixed seed. Keep each case focused enough that a failure loses only the points associated with that behavior.

An assertion is necessary, not proof of adequate coverage. Prefer observable game state over self-reported counters or labels: compare the resulting board, the revealed-cell set, collision geometry, or chip sums. Include negative boundaries (not parked, illegal action, no legal move), ordinary seeded play, and native-input/bridge equivalence. Merely checking `lastMove`, a scenario signature, or a declared total does not establish the corresponding mechanic. Changes to these scored observations require a new task major and benchmark minor, even when they correct an obvious coverage gap.

Build, preview, bridge readiness, and initial state validity are hard gates. Complex tasks should otherwise preserve granular partial credit. Texas Hold'em, for example, separates betting order, action legality, hand ranking, all-ins, side pots, split pots, and conservation checks.

## Quality gate

Before changing the release lock:

1. write a reference fixture that passes every case;
2. create focused deficient implementations or mutants that demonstrate each atomic test can fail;
3. run the complete suite repeatedly and compare test vectors;
4. check that native UI input and bridge actions reach equivalent state transitions;
5. test boundary states, not only a happy-path game;
6. run `pnpm cagb check`, `pnpm check`, and `pnpm cagb doctor`;
7. bump the task major and benchmark minor for any score-affecting change.

When a task is replaced, move its exact old package under `benchmark/retired/<release>/` so active discovery sees only the new baseline.
