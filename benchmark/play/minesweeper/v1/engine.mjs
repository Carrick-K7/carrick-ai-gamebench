/**
 * Deterministic Minesweeper reference engine (Play contract).
 *
 * Original, dependency-free, deterministic ESM implementation. It owns no
 * renderer, no browser global state, no Bridge, and no wall clock.
 *
 *   createGame(seed)                        // seed is an unsigned 32-bit int
 *     -> { dispatch(command), publicState(), snapshot(), outcome() }
 *
 * dispatch commands (engine commands, not a model/player interface):
 *   { type: "reveal", row, col }
 *   { type: "flag",   row, col }
 *
 * Rules: a 10x10 board with 10 mines. Mines are placed lazily on the first
 * successful reveal so that the first revealed cell and its valid eight
 * neighbors are always mine-free, guaranteeing a safe opening flood. Revealing
 * a mine loses; revealing every safe cell wins. Flags mark cells as suspected
 * mines and cannot be revealed until unflagged. The first reveal, the flood,
 * flags, and the terminal (immutable, no restart) are all deterministic from
 * the seed plus the command stream.
 */

const ROWS = 10;
const COLS = 10;
const MINES = 10;
const SAFE_CELLS = ROWS * COLS - MINES;

function createRng(seed) {
  let state = seed >>> 0;
  return {
    next() {
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

function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function blank2D(fill) {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(fill));
}

function clone2D(grid) {
  return grid.map((row) => row.slice());
}

export function createGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("seed must be a uint32");
  }

  const rng = createRng(seed >>> 0);
  const minefield = blank2D(false);
  const adjacent = blank2D(0);
  const revealed = blank2D(false);
  const flags = blank2D(false);
  let placed = false;
  let state = "playing"; // "playing" | "won" | "lost"

  function placeMines(anchorR, anchorC) {
    const excluded = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = anchorR + dr;
        const nc = anchorC + dc;
        if (inBounds(nr, nc)) excluded.add(nr * COLS + nc);
      }
    }
    const candidates = [];
    for (let i = 0; i < ROWS * COLS; i++) {
      if (!excluded.has(i)) candidates.push(i);
    }
    // Deterministic Fisher-Yates shuffle.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    for (let k = 0; k < MINES; k++) {
      const idx = candidates[k];
      minefield[Math.floor(idx / COLS)][idx % COLS] = true;
    }
    // Adjacent counts.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!minefield[r][c]) continue;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (inBounds(nr, nc)) adjacent[nr][nc] += 1;
          }
        }
      }
    }
    placed = true;
  }

  function countRevealedSafe() {
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (revealed[r][c] && !minefield[r][c]) count += 1;
      }
    }
    return count;
  }

  function revealAllMines() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (minefield[r][c]) revealed[r][c] = true;
      }
    }
  }

  function floodReveal(startR, startC) {
    const stack = [[startR, startC]];
    while (stack.length > 0) {
      const [r, c] = stack.pop();
      if (revealed[r][c] || flags[r][c]) continue;
      revealed[r][c] = true;
      if (adjacent[r][c] !== 0) continue; // number cells stop the flood
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (inBounds(nr, nc) && !revealed[nr][nc] && !flags[nr][nc]) {
            stack.push([nr, nc]);
          }
        }
      }
    }
  }

  function updateWin() {
    if (countRevealedSafe() === SAFE_CELLS) state = "won";
  }

  function revealCell(r, c) {
    if (!inBounds(r, c)) throw new Error(`cell out of bounds: (${r},${c})`);
    if (revealed[r][c]) return { ok: false, reason: "already-revealed" };
    if (flags[r][c]) return { ok: false, reason: "flagged" };
    if (!placed) placeMines(r, c);
    if (minefield[r][c]) {
      revealed[r][c] = true;
      state = "lost";
      revealAllMines(); // post-loss disclosure
      return { ok: true, changed: true, exploded: true };
    }
    floodReveal(r, c);
    updateWin();
    return { ok: true, changed: true, exploded: false };
  }

  function flagCell(r, c) {
    if (!inBounds(r, c)) throw new Error(`cell out of bounds: (${r},${c})`);
    if (revealed[r][c]) return { ok: false, reason: "already-revealed" };
    flags[r][c] = !flags[r][c];
    return { ok: true, changed: true };
  }

  function dispatch(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new Error("engine command must be an object");
    }
    const shape = Object.keys(command).sort().join(",");
    if (shape !== "col,row,type") {
      throw new Error("invalid engine command shape");
    }
    if (state !== "playing") {
      return { ok: false, reason: "terminal" };
    }
    if (command.type !== "reveal" && command.type !== "flag") {
      throw new Error(`unsupported command type: ${String(command.type)}`);
    }
    const { row, col } = command;
    if (!Number.isInteger(row) || !Number.isInteger(col) || !inBounds(row, col)) {
      throw new Error(`invalid cell: (${String(row)},${String(col)})`);
    }
    if (command.type === "reveal") return revealCell(row, col);
    return flagCell(row, col);
  }

  function publicState() {
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        if (revealed[r][c]) {
          if (minefield[r][c]) {
            row.push({ state: "revealed", mine: true });
          } else {
            row.push({ state: "revealed", adjacent: adjacent[r][c] });
          }
        } else if (flags[r][c]) {
          row.push({ state: "flagged" });
        } else {
          row.push({ state: "hidden" });
        }
      }
      cells.push(row);
    }
    return {
      rows: ROWS,
      cols: COLS,
      mine_count: MINES,
      cells,
      revealed: countRevealedSafe(),
      flags: countFlags(),
      remaining_mines: MINES - countFlags(),
      state,
      terminal: state !== "playing",
      won: state === "won",
    };
  }

  function countFlags() {
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (flags[r][c]) count += 1;
      }
    }
    return count;
  }

  function snapshot() {
    return {
      seed,
      rows: ROWS,
      cols: COLS,
      mine_count: MINES,
      minefield: clone2D(minefield),
      adjacent: clone2D(adjacent),
      revealed: clone2D(revealed),
      flags: clone2D(flags),
      placed,
      state,
      revealed_safe: countRevealedSafe(),
      safe_cells: SAFE_CELLS,
      rng: rng.getState(),
    };
  }

  function outcome() {
    return {
      terminal: state !== "playing",
      won: state === "won",
      score: countRevealedSafe(),
      revealed_safe: countRevealedSafe(),
      safe_cells: SAFE_CELLS,
    };
  }

  return { dispatch, publicState, snapshot, outcome };
}
