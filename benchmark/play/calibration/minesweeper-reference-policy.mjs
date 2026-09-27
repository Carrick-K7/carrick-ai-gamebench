/**
 * Minesweeper visible-only reference and random policies (calibration
 * baselines).
 *
 * These are calibration baselines only — they are NOT model player
 * implementations and never take part in ranking. They prove that a policy
 * using only the visible board (publicState) outperforms a uniform random
 * policy on a fixed calibration seed set under the native metric (win_rate),
 * using the exact engine/native command contract.
 *
 * The reference policy opens at the center, then repeatedly applies
 * deterministic constraint propagation (a revealed number whose remaining mine
 * count is zero reveals all its hidden neighbours; a number surrounded by
 * exactly its remaining mines flags all of them; plus pairwise subset
 * deduction) and only reveals a cell by probability when no cell is provably
 * safe or a provable mine. It consumes only `game.publicState()` and engine
 * commands.
 */

import { createGame } from "../minesweeper/v1/engine.mjs";

const ROWS = 10;
const COLS = 10;
const MINES = 10;

/** Fixed calibration seeds, deliberately separate from any episode seed set. */
export const CALIBRATION_SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1001];

function inB(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function neighborsOf(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (inB(nr, nc)) out.push([nr, nc]);
    }
  }
  return out;
}

/** Build a visibility-only model of the board. */
function model(state) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = state.cells[r][c];
      if (cell.state === "hidden") grid[r][c] = { kind: "hidden" };
      else if (cell.state === "flagged") grid[r][c] = { kind: "flag" };
      else if (cell.state === "revealed") {
        if (cell.mine === true) grid[r][c] = { kind: "mine" };
        else grid[r][c] = { kind: "num", num: cell.adjacent };
      }
    }
  }
  return grid;
}

function hiddenNeighbors(grid, r, c) {
  return neighborsOf(r, c).filter(([nr, nc]) => grid[nr][nc].kind === "hidden");
}

function flagCount(grid, r, c) {
  return neighborsOf(r, c).filter(([nr, nc]) => grid[nr][nc].kind === "flag").length;
}

function containsAll(setA, setB) {
  return setA.every(([r, c]) => setB.some(([br, bc]) => br === r && bc === c));
}

function difference(a, b) {
  return a.filter(([r, c]) => !b.some(([br, bc]) => br === r && bc === c));
}

/**
 * Deterministic constraint propagation. Returns cells that are provably safe
 * to reveal and cells that are provably mines to flag.
 */
function deduce(state) {
  const grid = model(state);
  const reveal = [];
  const flag = [];
  const seen = new Set();

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].kind !== "num" || grid[r][c].num === 0) continue;
      const hidden = hiddenNeighbors(grid, r, c);
      const remaining = grid[r][c].num - flagCount(grid, r, c);
      if (remaining === 0) {
        for (const [hr, hc] of hidden) {
          const k = hr * COLS + hc;
          if (!seen.has(k)) {
            seen.add(k);
            reveal.push([hr, hc]);
          }
        }
      } else if (remaining === hidden.length) {
        for (const [hr, hc] of hidden) {
          const k = hr * COLS + hc;
          if (!seen.has(k)) {
            seen.add(k);
            flag.push([hr, hc]);
          }
        }
      }
    }
  }

  // Pairwise subset deduction across revealed number cells.
  const nums = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].kind === "num" && grid[r][c].num > 0) nums.push([r, c]);
    }
  }
  for (const [ar, ac] of nums) {
    for (const [br, bc] of nums) {
      const HA = hiddenNeighbors(grid, ar, ac);
      const HB = hiddenNeighbors(grid, br, bc);
      if (HA.length === 0 || HB.length === 0) continue;
      const remA = grid[ar][ac].num - flagCount(grid, ar, ac);
      const remB = grid[br][bc].num - flagCount(grid, br, bc);
      if (containsAll(HA, HB)) {
        const extra = difference(HA, HB);
        const diff = remA - remB;
        if (diff === 0) {
          for (const [er, ec] of extra) {
            const k = er * COLS + ec;
            if (!seen.has(k)) {
              seen.add(k);
              reveal.push([er, ec]);
            }
          }
        } else if (diff === extra.length) {
          for (const [er, ec] of extra) {
            const k = er * COLS + ec;
            if (!seen.has(k)) {
              seen.add(k);
              flag.push([er, ec]);
            }
          }
        }
      }
      if (containsAll(HB, HA)) {
        const extra = difference(HB, HA);
        const diff = remB - remA;
        if (diff === 0) {
          for (const [er, ec] of extra) {
            const k = er * COLS + ec;
            if (!seen.has(k)) {
              seen.add(k);
              reveal.push([er, ec]);
            }
          }
        } else if (diff === extra.length) {
          for (const [er, ec] of extra) {
            const k = er * COLS + ec;
            if (!seen.has(k)) {
              seen.add(k);
              flag.push([er, ec]);
            }
          }
        }
      }
    }
  }
  return { reveal, flag };
}

/** Pick the hidden cell with the lowest estimated mine probability. */
function pickFallback(state) {
  const grid = model(state);
  let hiddenUnflagged = 0;
  let flags = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].kind === "hidden") hiddenUnflagged++;
      if (grid[r][c].kind === "flag") flags++;
    }
  }
  const minesLeft = MINES - flags;
  const base = minesLeft / Math.max(hiddenUnflagged, 1);
  let best = null;
  let bestProb = Infinity;
  let bestAdjacent = -1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].kind !== "hidden") continue;
      const adjacentNumbers = neighborsOf(r, c).filter(
        ([nr, nc]) => grid[nr][nc].kind === "num" && grid[nr][nc].num > 0,
      );
      let prob;
      if (adjacentNumbers.length === 0) {
        prob = base;
      } else {
        prob = 0;
        for (const [nr, nc] of adjacentNumbers) {
          const hiddenCount = hiddenNeighbors(grid, nr, nc).length;
          const remaining = grid[nr][nc].num - flagCount(grid, nr, nc);
          prob = Math.max(prob, remaining / Math.max(hiddenCount, 1));
        }
      }
      if (prob < bestProb - 1e-9 || (Math.abs(prob - bestProb) < 1e-9 && adjacentNumbers.length > bestAdjacent)) {
        bestProb = prob;
        best = [r, c];
        bestAdjacent = adjacentNumbers.length;
      }
    }
  }
  return best;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs the reference policy to the decision budget and returns the outcome. */
export function playReference(seed, maxDecisions = 128) {
  const game = createGame(seed);
  // Center opening guarantees a large, safe flood.
  game.dispatch({ type: "reveal", row: 5, col: 5 });
  for (let i = 1; i < maxDecisions; i++) {
    if (game.outcome().terminal) break;
    const state = game.publicState();
    const { reveal, flag } = deduce(state);
    if (reveal.length > 0) {
      game.dispatch({ type: "reveal", row: reveal[0][0], col: reveal[0][1] });
    } else if (flag.length > 0) {
      game.dispatch({ type: "flag", row: flag[0][0], col: flag[0][1] });
    } else {
      const fallback = pickFallback(state);
      if (!fallback) break;
      game.dispatch({ type: "reveal", row: fallback[0], col: fallback[1] });
    }
  }
  return game.outcome();
}

/** Runs a uniform random policy (seeded) and returns the outcome. */
export function playRandom(seed, rngSeed, maxDecisions = 128) {
  const game = createGame(seed);
  const rng = mulberry32(rngSeed);
  for (let i = 0; i < maxDecisions; i++) {
    if (game.outcome().terminal) break;
    const hidden = [];
    const state = game.publicState();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.cells[r][c].state === "hidden") hidden.push([r, c]);
      }
    }
    if (hidden.length === 0) break;
    const [r, c] = hidden[Math.floor(rng() * hidden.length)];
    game.dispatch({ type: "reveal", row: r, col: c });
  }
  return game.outcome();
}

/** Runs both policies over the calibration seeds and returns raw outcomes. */
export function calibrate(seeds = CALIBRATION_SEEDS, maxDecisions = 128) {
  const referenceWins = [];
  const randomWins = [];
  for (const seed of seeds) {
    referenceWins.push(playReference(seed, maxDecisions).won);
    randomWins.push(playRandom(seed, seed, maxDecisions).won);
  }
  return { seeds, referenceWins, randomWins };
}
