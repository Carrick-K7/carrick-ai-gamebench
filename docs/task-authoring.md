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
- Every declared scored test references a case in `tests/cases.json`.
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

Use explicit fixture seeds for deterministic scenarios inside the one canonical evaluation. Keep each case focused enough that a failure loses only the points associated with that behavior.

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
