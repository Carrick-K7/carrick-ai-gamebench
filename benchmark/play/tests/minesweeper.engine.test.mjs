import assert from "node:assert/strict";
import test from "node:test";
import { createGame } from "../minesweeper/v1/engine.mjs";

function collectUndefined(value, path) {
  if (typeof value === "undefined") return [`${path} is undefined`];
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => collectUndefined(entry, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => collectUndefined(v, `${path}.${k}`));
  }
  return [];
}

function firstRevealAndMines(seed) {
  const game = createGame(seed);
  const anchor = [5, 5];
  const before = game.snapshot();
  assert.equal(before.placed, false, "mines are not placed before the first reveal");
  game.dispatch({ type: "reveal", row: anchor[0], col: anchor[1] });
  const after = game.snapshot();
  assert.equal(after.placed, true, "mines are placed on the first reveal");
  const mineList = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      if (after.minefield[r][c]) mineList.push([r, c]);
    }
  }
  return { game, after, mineList, anchor };
}

function assertNoHiddenLeak(publicState) {
  for (const row of publicState.cells) {
    for (const cell of row) {
      if (cell.state === "hidden" || cell.state === "flagged") {
        assert.ok(!("mine" in cell), "hidden/flagged cell leaked mine flag");
        assert.ok(!("adjacent" in cell), "hidden/flagged cell leaked adjacent count");
      }
    }
  }
}

test("minesweeper: createGame rejects non-uint32 seeds", () => {
  for (const bad of [-1, 1.5, "1", null, 2 ** 32, NaN]) {
    assert.throws(() => createGame(bad), /uint32/);
  }
});

test("minesweeper: initial board is fully hidden with no leaked info", () => {
  const game = createGame(1);
  const state = game.publicState();
  assert.equal(state.rows, 10);
  assert.equal(state.cols, 10);
  assert.equal(state.mine_count, 10);
  assert.equal(state.state, "playing");
  assert.equal(state.terminal, false);
  assert.equal(state.revealed, 0);
  assert.equal(state.cells.length, 10);
  for (const row of state.cells) assert.equal(row.length, 10);
  for (const row of state.cells) for (const cell of row) assert.equal(cell.state, "hidden");
  assertNoHiddenLeak(state);
  // Hidden state is private until the first reveal.
  const snap = game.snapshot();
  assert.equal(snap.placed, false);
  assert.equal(snap.mine_count, 10);
});

test("minesweeper: same seed and command stream produce identical snapshots", () => {
  const a = createGame(123);
  const b = createGame(123);
  const stream = [
    { type: "reveal", row: 5, col: 5 },
    { type: "flag", row: 0, col: 0 },
    { type: "reveal", row: 0, col: 1 },
    { type: "reveal", row: 9, col: 9 },
    { type: "flag", row: 1, col: 1 },
    { type: "reveal", row: 4, col: 4 },
  ];
  for (const command of stream) {
    a.dispatch(command);
    b.dispatch(command);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(a.publicState(), b.publicState());
  }
});

test("minesweeper: snapshot and publicState are deep copies (no aliasing)", () => {
  const game = createGame(22);
  game.dispatch({ type: "reveal", row: 5, col: 5 });
  const snap = game.snapshot();
  const pub = game.publicState();
  const originalMine = snap.minefield[0][0];
  const originalRng = snap.rng;
  const originalCell = JSON.parse(JSON.stringify(pub.cells[0][0]));
  const originalRevealed = pub.revealed;
  snap.minefield[0][0] = !originalMine;
  snap.rng = 0;
  pub.cells[0][0] = { state: "flagged" };
  pub.revealed = 999;
  assert.equal(game.snapshot().minefield[0][0], originalMine);
  assert.equal(game.snapshot().rng, originalRng);
  assert.deepEqual(game.publicState().cells[0][0], originalCell);
  assert.equal(game.publicState().revealed, originalRevealed);
});

test("minesweeper: dispatch rejects malformed and off-contract commands", () => {
  const game = createGame(5);
  const before = game.snapshot();
  for (const bad of [
    null,
    undefined,
    "reveal",
    { type: "move", direction: "up" },
    { type: "reveal", row: -1, col: 0 },
    { type: "reveal", row: 0, col: 10 },
    { type: "reveal", row: 0.5, col: 0 },
    { type: "flag", row: 0, col: 0, extra: 1 },
    { type: "reveal", row: 0, col: 0, extra: 1 },
  ]) {
    assert.throws(() => game.dispatch(bad));
  }
  assert.deepEqual(game.snapshot(), before);
});

test("minesweeper: first reveal is always safe and triggers an opening flood", () => {
  const { game, after, anchor } = firstRevealAndMines(999);
  // The anchor cell itself is revealed as a 0 (no adjacent mines).
  const anchorCell = game.publicState().cells[anchor[0]][anchor[1]];
  assert.equal(anchorCell.state, "revealed");
  assert.equal(anchorCell.adjacent, 0);
  // No mine lies in the anchor cell or within its 8-neighborhood.
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = anchor[0] + dr;
      const c = anchor[1] + dc;
      if (r >= 0 && r < 10 && c >= 0 && c < 10) {
        assert.equal(after.minefield[r][c], false, `mine in the safe opening at (${r},${c})`);
      }
    }
  }
  // Exactly 10 mines are placed somewhere on the board.
  const mineCount = after.minefield.flat().filter(Boolean).length;
  assert.equal(mineCount, 10);
  // The flood revealed a meaningful opening (more than the single cell).
  assert.ok(after.revealed_safe >= 9, `expected a flood opening, got ${after.revealed_safe}`);
});

test("minesweeper: hidden cells never leak mines or adjacency across all outcomes", () => {
  const seeds = [3, 77, 4096];
  for (const seed of seeds) {
    const { game, mineList, anchor } = firstRevealAndMines(seed);
    assertNoHiddenLeak(game.publicState());
    // Lose on a known mine.
    game.dispatch({ type: "reveal", row: mineList[0][0], col: mineList[0][1] });
    const lost = game.publicState();
    assert.equal(lost.state, "lost");
    assert.equal(lost.terminal, true);
    assert.equal(lost.won, false);
    assertNoHiddenLeak(lost); // post-loss disclosure: revealed mines carry mine:true
    // Revealed mine cells must carry mine:true now.
    const revealedMines = lost.cells
      .flat()
      .filter((cell) => cell.state === "revealed" && cell.mine === true).length;
    assert.ok(revealedMines >= 10, `expected all mines disclosed, saw ${revealedMines}`);
  }
});

test("minesweeper: revealing every safe cell wins", () => {
  const { game, after } = firstRevealAndMines(2026);
  let revealedSafe = after.revealed_safe;
  while (game.outcome().state !== "won" && revealedSafe < 90) {
    // Find a hidden, unflagged non-mine cell and reveal it.
    const snap = game.snapshot();
    let target = null;
    for (let r = 0; r < 10 && !target; r++) {
      for (let c = 0; c < 10 && !target; c++) {
        if (!snap.revealed[r][c] && !snap.minefield[r][c] && !snap.flags[r][c]) {
          target = [r, c];
        }
      }
    }
    if (!target) break;
    game.dispatch({ type: "reveal", row: target[0], col: target[1] });
    revealedSafe = game.outcome().revealed_safe;
  }
  const outcome = game.outcome();
  assert.equal(outcome.won, true, "all safe cells revealed should win");
  assert.equal(outcome.terminal, true);
  assert.equal(outcome.revealed_safe, 90);
  assert.equal(outcome.safe_cells, 90);
});

test("minesweeper: flags toggle and gate reveals", () => {
  const { game, mineList } = firstRevealAndMines(555);
  // Flag a safe cell, then attempt to reveal it (no-op), unflag, then reveal.
  let safe = null;
  const snap = game.snapshot();
  for (let r = 0; r < 10 && !safe; r++) {
    for (let c = 0; c < 10 && !safe; c++) {
      if (!snap.revealed[r][c] && !snap.minefield[r][c] && !snap.flags[r][c]) {
        safe = [r, c];
      }
    }
  }
  assert.ok(safe, "expected a safe unrevealed cell");
  const flagResult = game.dispatch({ type: "flag", row: safe[0], col: safe[1] });
  assert.equal(flagResult.ok, true);
  // Reveal on a flagged cell is a no-op.
  const revealOnFlag = game.dispatch({ type: "reveal", row: safe[0], col: safe[1] });
  assert.equal(revealOnFlag.ok, false);
  assert.equal(revealOnFlag.reason, "flagged");
  assert.equal(game.publicState().cells[safe[0]][safe[1]].state, "flagged");
  // Toggle the flag off, then reveal succeeds.
  game.dispatch({ type: "flag", row: safe[0], col: safe[1] });
  const revealResult = game.dispatch({ type: "reveal", row: safe[0], col: safe[1] });
  assert.equal(revealResult.ok, true);
  assert.equal(game.publicState().cells[safe[0]][safe[1]].state, "revealed");
  // Flagging a revealed cell is a no-op.
  const flagRevealed = game.dispatch({ type: "flag", row: safe[0], col: safe[1] });
  assert.equal(flagRevealed.ok, false);
  assert.equal(flagRevealed.reason, "already-revealed");
  assert.equal(mineList.length, 10);
});

test("minesweeper: terminal state is immutable", () => {
  const { game, mineList } = firstRevealAndMines(42);
  game.dispatch({ type: "reveal", row: mineList[0][0], col: mineList[0][1] });
  assert.equal(game.outcome().terminal, true);
  assert.equal(game.outcome().won, false);
  const before = game.snapshot();
  const attempts = [
    { type: "reveal", row: 9, col: 9 },
    { type: "flag", row: 0, col: 0 },
  ];
  for (const attempt of attempts) {
    const result = game.dispatch(attempt);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "terminal");
  }
  assert.deepEqual(game.snapshot(), before);
});

test("minesweeper: publicState/snapshot are JSON-safe", () => {
  const { game, mineList } = firstRevealAndMines(12);
  assert.deepEqual(collectUndefined(game.snapshot(), "snapshot"), []);
  assert.deepEqual(collectUndefined(game.publicState(), "publicState"), []);
  JSON.stringify(game.snapshot());
  game.dispatch({ type: "reveal", row: mineList[0][0], col: mineList[0][1] });
  assert.deepEqual(collectUndefined(game.snapshot(), "snapshot"), []);
  assert.deepEqual(collectUndefined(game.publicState(), "publicState"), []);
  JSON.stringify(game.snapshot());
});
