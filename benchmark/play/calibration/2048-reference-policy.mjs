/**
 * 2048 visible-only reference and random policies (calibration baselines).
 *
 * These are calibration baselines only — they are NOT model player
 * implementations and never take part in ranking. They exist to prove that a
 * policy using only the visible board (publicState) outperforms a uniform
 * random policy on a fixed calibration seed set under the native metric
 * (mean_score), using the exact engine/native command contract.
 *
 * The reference policy is a deterministic 1-ply expectimax over the 9:1
 * 2/4-spawn distribution, evaluated by a weighted-corner + empty-cell +
 * smoothness heuristic. It consumes only `game.publicState()` and the engine
 * commands.
 */

import { createGame } from "../2048/v1/engine.mjs";

const SIZE = 4;
const DIRS = ["up", "down", "left", "right"];

/** Fixed calibration seeds, deliberately separate from any episode seed set. */
export const CALIBRATION_SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1001];

function clone(board) {
  return board.map((row) => row.slice());
}

function slideLine(values) {
  const tiles = values.filter((v) => v !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      const merged = tiles[i] * 2;
      out.push(merged);
      gained += merged;
      i++;
    } else {
      out.push(tiles[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  const moved = out.some((v, i) => v !== values[i]);
  return { values: out, moved, gained };
}

/** Merge-only slide of the board in `direction` (no spawn), for lookahead. */
function slideBoard(board, direction) {
  const lines = [];
  if (direction === "left" || direction === "right") {
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) row.push(board[r][c]);
      if (direction === "right") row.reverse();
      lines.push(row);
    }
  } else {
    for (let c = 0; c < SIZE; c++) {
      const col = [];
      for (let r = 0; r < SIZE; r++) col.push(board[r][c]);
      if (direction === "down") col.reverse();
      lines.push(col);
    }
  }
  const results = lines.map((line) => slideLine(line));
  const next = clone(board);
  let moved = false;
  if (direction === "left" || direction === "right") {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) next[r][c] = results[r].values[c];
      if (results[r].moved) moved = true;
    }
  } else {
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r < SIZE; r++) next[r][c] = results[c].values[r];
      if (results[c].moved) moved = true;
    }
  }
  return { board: next, moved };
}

function empties(board) {
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) cells.push([r, c]);
    }
  }
  return cells;
}

function evaluate(board) {
  const W = [
    [16, 15, 14, 13],
    [15, 12, 11, 10],
    [14, 11, 8, 7],
    [13, 10, 7, 4],
  ];
  let score = 0;
  let empty = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v === 0) empty++;
      else score += Math.log2(v) * W[r][c];
    }
  }
  let smooth = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v === 0) continue;
      if (c + 1 < SIZE && board[r][c + 1] !== 0) {
        smooth -= Math.abs(Math.log2(v) - Math.log2(board[r][c + 1]));
      }
      if (r + 1 < SIZE && board[r + 1][c] !== 0) {
        smooth -= Math.abs(Math.log2(v) - Math.log2(board[r + 1][c]));
      }
    }
  }
  return score + empty * 30 + smooth * 2;
}

/** Deterministic 1-ply expectimax over the 2/4 spawn distribution. */
function bestDirection(board) {
  let best = null;
  let bestValue = -Infinity;
  for (const direction of DIRS) {
    const { board: merged, moved } = slideBoard(board, direction);
    if (!moved) continue;
    const spawnCells = empties(merged);
    let expected = 0;
    for (const [r, c] of spawnCells) {
      // 2 with probability 0.9, 4 with probability 0.1.
      const b2 = clone(merged);
      b2[r][c] = 2;
      expected += 0.9 * evaluate(b2);
      const b4 = clone(merged);
      b4[r][c] = 4;
      expected += 0.1 * evaluate(b4);
    }
    expected /= Math.max(spawnCells.length, 1);
    if (expected > bestValue) {
      bestValue = expected;
      best = direction;
    }
  }
  return best ?? "up";
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

/** Runs the reference policy to the decision budget and returns the score. */
export function playReference(seed, maxDecisions = 200) {
  const game = createGame(seed);
  for (let i = 0; i < maxDecisions; i++) {
    if (game.outcome().terminal) break;
    const board = game.publicState().board;
    game.dispatch({ type: "move", direction: bestDirection(board) });
  }
  return game.outcome();
}

/** Runs a uniform random policy (seeded) and returns the score. */
export function playRandom(seed, rngSeed, maxDecisions = 200) {
  const game = createGame(seed);
  const rng = mulberry32(rngSeed);
  for (let i = 0; i < maxDecisions; i++) {
    if (game.outcome().terminal) break;
    const direction = DIRS[Math.floor(rng() * DIRS.length)];
    game.dispatch({ type: "move", direction });
  }
  return game.outcome();
}

/** Runs both policies over the calibration seeds and returns raw scores. */
export function calibrate(seeds = CALIBRATION_SEEDS, maxDecisions = 200) {
  const referenceScores = [];
  const randomScores = [];
  for (const seed of seeds) {
    referenceScores.push(playReference(seed, maxDecisions).score);
    randomScores.push(playRandom(seed, seed, maxDecisions).score);
  }
  return { seeds, referenceScores, randomScores };
}
