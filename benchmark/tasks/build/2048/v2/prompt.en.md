# Build task: 2048

Create a polished, playable 2048 game as a browser application.

## Required game

- A 4×4 board starts with two tiles.
- Arrow keys move all tiles. Equal adjacent tiles merge once per move.
- `[2,2,2,0] → [4,2,0,0]` and `[2,2,2,2] → [4,4,0,0]`.
- Spawn one 2 or 4 only after an effective move; 2 must be more likely.
- Show score, restart, the 2048 win state, and the no-legal-move loss state.
- Rapid input and restart must not corrupt state.

## Public automation contract

Implement bridge actions `start`, `move` with `{direction:"left|right|up|down"}`,
and `restart`. Snapshot state must follow `state.schema.json`.

The following scenarios are fixtures, not cheats: `merge-2220` starts with the
first row `[2,2,2,0]`; `no-op-left` has a left-packed board and `spawnCount=0`;
`near-win` has adjacent 1024 tiles; `deterministic` with seed `104729` starts
with 2 at `[0,0]` and `[1,1]`. Scenario resets do not count initial fixtures as
spawns. Real Arrow key events must use the same movement path as bridge actions.

Do not read test files at runtime or special-case the evaluator. No runtime
network requests are allowed.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
