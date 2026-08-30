# Build task: Tetris

Create a complete browser Tetris game.

## Required game

- A 10×20 board and all seven tetrominoes I, O, T, S, Z, J, and L.
- Automatic fall, left/right movement, rotation, soft drop, hard drop, locking,
  complete-line removal, scoring, speed/level progression, next preview,
  pause/resume, restart, and game over.
- Rotation must never leave the board or overlap locked cells. O remains stable.
- Hard drop locks immediately. Pause stops all simulation time.

## Public automation contract

Bridge actions: `move-left`, `move-right`, `rotate`, `soft-drop`, `hard-drop`,
`pause`, `resume`, and `restart`. Snapshot follows `state.schema.json`.

Fixtures: `all-pieces` reports all seven types in `piecesSeen`; `wall-rotation`
places an I piece at the left wall; `single-line` is one hard drop away from a
clear; `hard-drop` starts a T piece at y=0 on an empty board; `score-level` is
one clear away from 10 total lines. Arrow keys, Space, P/Escape, and R must use
the same state transitions as bridge actions.

No runtime network requests or evaluator-specific branches.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
