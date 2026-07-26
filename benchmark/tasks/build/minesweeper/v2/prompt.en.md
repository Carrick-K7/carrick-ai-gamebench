# Build task: Minesweeper

Create a polished, playable Minesweeper game.

## Required game

- Default board: 10×10 with 10 mines.
- Left click reveals; right click toggles a flag and suppresses the browser menu.
- Show remaining mine count, elapsed time, and status.
- Numbers count all eight neighbors. Revealing a zero recursively reveals its
  connected safe region and numbered boundary.
- Flags cannot be revealed. Revealing a mine loses and reveals all mines.
- Revealing every safe cell wins. Finished games reject further input.
- Restart clears the board, timer, flags, and terminal state.

## Public automation contract

Bridge actions are `reveal` and `toggle-flag` with `{row,col}`, plus `restart`.
Snapshot state follows `state.schema.json`. Render DOM cells with
`data-cell="row-col"` so real pointer input can be checked.

Fixtures: `corner-count` has one mine at `[1,1]`; `flood-region` has mines only
in the last column; `flag-cell` has a mine at `[1,1]`; `near-win` has only
`[0,0]` safe and unrevealed. The deterministic seed fixture has ten mines and
reports `mineSignature` as
`0,7;1,3;2,8;3,1;4,6;5,4;6,9;7,2;8,5;9,0`.

Do not read test files at runtime or special-case the evaluator. No runtime
network requests are allowed.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
