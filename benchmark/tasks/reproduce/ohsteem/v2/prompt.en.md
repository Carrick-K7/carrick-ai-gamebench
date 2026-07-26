# Reproduction task: OhSteem

Reproduce the mechanics, interaction feel, and visual identity shown in the
provided OhSteem reference pack. This is a scoped reproduction task based on
the MIT-licensed project at the frozen commit recorded in `THIRD_PARTY.yml`.
Do not search for or copy its source during the run.

## Required slice

- A home/size-selection view and playable 4×4 and 6×6 binary puzzle boards.
- Each editable tile cycles empty → orange → blue → empty.
- A valid completed row/column has equal orange and blue counts.
- No row/column may contain three consecutive tiles of the same color.
- No two completed rows may be identical; the same applies to columns.
- Clue cells are visibly fixed and cannot be edited.
- Give immediate, visible invalid-state feedback without destroying the move.
- Detect completion, show a satisfying win state, and support a clean new game.
- Match the typography, warm orange, deep blue, spacing, tile animation, and
  compact mobile-like composition in the supplied captures.

Reference material is available at `$CAGB_REFERENCE_DIR/reference/index.html`.
The game view uses `#game-menu` (950×569) and `#game-board` (788×652) for the
two published visual checkpoints. Editable cells use `data-cell="row-col"`.

Bridge actions: `cell` with `{row,col}`, `select-size` with `{size}`, and
`new-game`. Snapshot follows `state.schema.json`. Fixture behavior is fully
declared in the public tests. No runtime network requests are allowed.

## Evaluation contract

The complete public fixture contract is available at `$CAGB_PUBLIC_TESTS_PATH`,
and the scored task manifest is at `$CAGB_TASK_MANIFEST_PATH`. Read both before
implementing. Every bridge reset must apply its input seed, and every snapshot
must report that integer as the top-level `seed` field. The official run seed is
also available as `$CAGB_SEED`.
