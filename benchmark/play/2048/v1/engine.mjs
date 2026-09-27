/**
 * Deterministic 2048 reference engine (Play contract).
 *
 * This is an original, dependency-free, deterministic ESM implementation of
 * the 2048 move/merge/spawn rules. It owns no renderer, no browser global
 * state, no Bridge, and no wall clock. It is a pure state machine:
 *
 *   createGame(seed)                        // seed is an unsigned 32-bit int
 *     -> { dispatch(command), publicState(), snapshot(), outcome() }
 *
 * dispatch commands (engine commands, not a model/player interface):
 *   { type: "move", direction: "up"|"down"|"left"|"right" }
 *
 * Determinism: the seeded PRNG (mulberry32) drives only the spawn of new
 * tiles and the two initial tiles. Score, merges, and board layout are pure
 * functions of the starting seed and the dispatched command stream, so any
 * process can replay the exact same state and score from the seed plus the
 * command sequence.
 */

const SIZE = 4;
const WIN_TILE = 2048;

/** mulberry32 PRNG with a serializable/resumable internal state. */
function createRng(seed) {
  let state = seed >>> 0;
  return {
    next() {
      // Standard mulberry32 advancement.
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    getState() {
      return state;
    },
    setState(next) {
      state = next >>> 0;
    },
  };
}

function emptyBoard() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
}

/** Copy a board to a fresh array (never hand out live rows). */
function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function boardMax(board) {
  let max = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v > max) max = v;
    }
  }
  return max;
}

/**
 * Slide and merge one line toward the edge. `values` is ordered so index 0 is
 * closest to the target edge. Standard 2048 rules: tiles slide, each tile
 * merges at most once per move, and the merged value is added to the score.
 *
 * Exported as an internal helper for direct rule tests; it is not part of the
 * `createGame` contract.
 */
export function slideLine(values) {
  const tiles = values.filter((v) => v !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      const merged = tiles[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // consume the partner tile so it cannot merge again this move
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  const moved = out.some((v, i) => v !== values[i]);
  return { values: out, moved, gained };
}

/** Returns the cell coordinates of each line, ordered toward the target edge. */
function lineCoords(direction) {
  const coords = [];
  if (direction === "left" || direction === "right") {
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) row.push([r, c]);
      if (direction === "right") row.reverse();
      coords.push(row);
    }
  } else {
    for (let c = 0; c < SIZE; c++) {
      const col = [];
      for (let r = 0; r < SIZE; r++) col.push([r, c]);
      if (direction === "down") col.reverse();
      coords.push(col);
    }
  }
  return coords;
}

const DIRECTIONS = ["up", "down", "left", "right"];

export function createGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("seed must be a uint32");
  }

  const rng = createRng(seed >>> 0);
  let board = emptyBoard();
  let score = 0;
  let effectiveMoves = 0;
  let terminal = false;
  let won = false;

  function spawnTile() {
    const empty = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) empty.push([r, c]);
      }
    }
    if (empty.length === 0) return false;
    // Two PRNG draws per spawn: cell index (uniform among empties), then value
    // (2 with probability 0.9, 4 with probability 0.1).
    const index = Math.floor(rng.next() * empty.length);
    const value = rng.next() < 0.9 ? 2 : 4;
    const [r, c] = empty[index];
    board[r][c] = value;
    return true;
  }

  function hasLegalMove() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) return true;
        if (c + 1 < SIZE && board[r][c] === board[r][c + 1]) return true;
        if (r + 1 < SIZE && board[r][c] === board[r + 1][c]) return true;
      }
    }
    return false;
  }

  function applyMove(direction) {
    const lines = lineCoords(direction);
    let changed = false;
    let gained = 0;
    const results = lines.map((line) => {
      const values = line.map(([r, c]) => board[r][c]);
      const res = slideLine(values);
      if (res.moved) changed = true;
      gained += res.gained;
      return res.values;
    });
    lines.forEach((line, index) => {
      line.forEach(([r, c], position) => {
        board[r][c] = results[index][position];
      });
    });
    if (changed) {
      score += gained;
      effectiveMoves += 1;
      // A new tile is added only after an effective move.
      spawnTile();
    }
    if (!won && boardMax(board) >= WIN_TILE) won = true;
    if (!hasLegalMove()) terminal = true;
  }

  function dispatch(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new Error("engine command must be an object");
    }
    const shape = Object.keys(command).sort().join(",");
    if (shape !== "direction,type") {
      throw new Error("invalid engine command shape");
    }
    // A finished game is immutable: valid commands become no-ops.
    if (terminal) {
      return { ok: false, reason: "terminal", changed: false, gained: 0 };
    }
    if (command.type !== "move") {
      throw new Error(`unsupported command type: ${String(command.type)}`);
    }
    const direction = command.direction;
    if (!DIRECTIONS.includes(direction)) {
      throw new Error(`invalid move direction: ${String(direction)}`);
    }
    const before = cloneBoard(board);
    const previousScore = score;
    applyMove(direction);
    const changed = !sameBoard(before, board);
    return {
      ok: true,
      changed,
      spawned: changed,
      gained: score - previousScore,
    };
  }

  function publicState() {
    return {
      board: cloneBoard(board),
      score,
      max_tile: boardMax(board),
      terminal,
      won,
      size: SIZE,
      win_tile: WIN_TILE,
    };
  }

  function snapshot() {
    return {
      seed,
      board: cloneBoard(board),
      score,
      max_tile: boardMax(board),
      effective_moves: effectiveMoves,
      terminal,
      won,
      rng: rng.getState(),
    };
  }

  function outcome() {
    return {
      terminal,
      won,
      score,
      max_tile: boardMax(board),
      effective_moves: effectiveMoves,
    };
  }

  // The two initial tiles are spawned deterministically from the seed.
  spawnTile();
  spawnTile();
  if (!hasLegalMove()) terminal = true;

  return { dispatch, publicState, snapshot, outcome };
}

function sameBoard(a, b) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}
