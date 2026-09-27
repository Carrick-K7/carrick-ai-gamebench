# Play reference games

This directory holds the maintainer-owned reference game packages for the Play
suite. They live **outside** the legacy recursive Build task loader
(`benchmark/tasks/`), so they do not contribute to Build task discovery,
hashes, or Agent workspaces.

## Layout

```text
benchmark/play/
  2048/v1/           # play.2048.v1
    task.yml
    engine.mjs
    renderer.mjs
    prompt.en.md
    prompt.zh.md
    LICENSE
  minesweeper/v1/    # play.minesweeper.v1
    task.yml
    engine.mjs
    renderer.mjs
    prompt.en.md
    prompt.zh.md
    LICENSE
  tests/             # reference engine/renderer/dom tests (node:test)
  calibration/       # reference-vs-random baseline calibration
```

Each game directory is a self-contained, dependency-free ESM package whose
logic, renderer, resources, prompt, manifest, and license are hashed together
by the parent Play harness. All imports stay inside the task directory.

## Engine contract

`engine.mjs` exports `createGame(seed)`, where `seed` is an unsigned 32-bit
integer. It returns exactly:

```js
{
  dispatch(command),       // engine command -> result object
  publicState(),           // visible, deep-copied projection
  snapshot(),              // private deterministic deep copy (incl. RNG state)
  outcome(),               // { terminal, won, score, ... }
}
```

- `dispatch` is a pure command interface, not a player/model interface.
- `publicState()` is a JSON-safe, positively constructed *visible* projection,
  built fresh and deep-copied every call.
- `snapshot()` is a JSON-safe private deterministic copy including RNG state,
  used only for runner evidence/replay. It is never shown to a player.
- `outcome()` returns the canonical engine outcome used for scoring. The
  browser UI text is never used for scoring.
- The engine owns no renderer, no browser global state, no Bridge, and no wall
  clock. A terminated game is immutable (no restart command).

### Commands

| game        | commands |
| ---         | --- |
| 2048        | `{ type: "move", direction: "up" | "down" | "left" | "right" }` |
| minesweeper | `{ type: "reveal" \| "flag", row: 0..9, col: 0..9 }` |

`dispatch` rejects non-object commands, wrong key sets, unknown types, and
out-of-contract parameters; a valid command on a finished game is a no-op.

### `publicState()` shapes

**2048** (fully visible):

```js
{
  board: number[4][4],  // tile values, 0 = empty
  score: number,
  max_tile: number,
  terminal: boolean,
  won: boolean,
  size: 4,
  win_tile: 2048,
}
```

**Minesweeper** (hidden state boundary — no mine or adjacent count is ever
present on an unrevealed cell):

```js
{
  rows, cols, mine_count,   // 10, 10, 10
  cells: [ { state } | { state, adjacent } | { state, mine } ][10][10],
    // state: "hidden" | "flagged" | "revealed"
    // revealed non-mine cell -> { state:"revealed", adjacent: 0..8 }
    // revealed mine (only after a loss) -> { state:"revealed", mine: true }
  revealed, flags, remaining_mines,
  state: "playing" | "won" | "lost",
  terminal, won,
}
```

A hidden/flagged cell carries **only** its `state` — never `mine` or
`adjacent`. Revealed mines appear only after a legitimate loss (post-loss
disclosure). Before any reveal, all cells are `hidden` and the minefield is
private.

### `snapshot()` shapes

**2048:**

```js
{ seed, board, score, max_tile, effective_moves, terminal, won, rng }
```

**Minesweeper:**

```js
{ seed, rows, cols, mine_count, minefield, adjacent, revealed, flags, placed,
  state, revealed_safe, safe_cells, rng }
```

### `outcome()` shapes

```js
2048:        { terminal, won, score, max_tile, effective_moves }
minesweeper: { terminal, won, score, revealed_safe, safe_cells }
```

For minesweeper, `score` equals the number of revealed safe cells; the primary
native metric is `win_rate` (see each task's `task.yml`).

## Renderer contract

`renderer.mjs` exports:

```js
export function mountGame(root, { onCommand }) -> { render(publicState), destroy() }
export function nativeActionForCommand(command) -> native key/pointer payload
```

- `mountGame` maps **real** native events to engine commands and calls
  `onCommand(command)`. It never owns or resets the engine and never exposes a
  privileged Bridge.
- **Each event delivers exactly one command**, and `onCommand` may be async:
  the renderer fires the command and swallows a rejection rather than
  propagating an unhandled rejection. The host is responsible for turn
  correlation/deduplication.
- `render(publicState)` re-renders the DOM from the given visible state; it
  never mutates the engine. `mountGame` does **not** call `render` — nothing
  is drawn until the first `publicState` arrives.
- `destroy()` removes document listeners and the DOM.
- `nativeActionForCommand` returns the exact native payload a scripted player
  must issue to reproduce the same command stream at the fixed 1280x720 DPR-1
  geometry:
  - 2048 move -> `{ type: "key", key: "ArrowUp" | ... }`
  - minesweeper reveal/flag -> `{ type: "click", button: "left" | "right", x, y }`
- The minesweeper renderer additionally exports `GEOMETRY`, the fixed layout
  constants the renderer and `nativeActionForCommand` share, so the two can
  never disagree.
- **Self-contained**: `renderer.mjs` has zero imports and performs no network
  or resource fetches. It is the only file served to the scored browser; the
  engine/source/task files are not shipped to the browser.
- No animation, no wall clock, no external assets, no network.

## Tests and calibration

- `benchmark/play/tests/*.test.mjs` — engine determinism, snapshot/publicState
  aliasing, invalid-input rejection, rule properties, the hidden-state leak
  boundary, `nativeActionForCommand` mapping, and a DOM smoke test.
- `benchmark/play/calibration/*.test.mjs` — visible-only reference policies vs
  uniform random policies on a fixed calibration seed set, checking native
  metric sensitivity (`mean_score` for 2048, `win_rate` for minesweeper). See
  `calibration/README.md`.

Run everything in Node (native `node:test`, no framework):

```bash
node --test $(find benchmark/play -name "*.test.mjs" | sort)
```

The calibration can also be run as a single in-process check (no browser, no
model calls) via `tools/calibrate-play.mjs`:
