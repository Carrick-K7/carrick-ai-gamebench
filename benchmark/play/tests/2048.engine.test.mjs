import assert from "node:assert/strict";
import test from "node:test";
import { createGame, slideLine } from "../2048/v1/engine.mjs";

const DIRECTIONS = ["up", "down", "left", "right"];

function playDeterministic(seed, moves = 400) {
  const game = createGame(seed);
  let directionIndex = 0;
  const snapshotTrace = [];
  for (let i = 0; i < moves; i++) {
    const direction = DIRECTIONS[directionIndex++ % DIRECTIONS.length];
    game.dispatch({ type: "move", direction });
    snapshotTrace.push(game.snapshot());
    if (game.outcome().terminal) break;
  }
  return { game, snapshotTrace };
}

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

function countTiles(board) {
  let count = 0;
  for (const row of board) for (const v of row) if (v !== 0) count++;
  return count;
}

function boardSum(board) {
  return board.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0);
}

test("2048: createGame rejects non-uint32 seeds", () => {
  for (const bad of [-1, 1.5, "1", null, 2 ** 32, NaN]) {
    assert.throws(() => createGame(bad), /uint32/);
  }
});

test("2048: initial state has exactly two tiles worth 2 or 4 and zero score", () => {
  const game = createGame(42);
  const state = game.publicState();
  assert.equal(countTiles(state.board), 2);
  let max = 0;
  for (const row of state.board) for (const v of row) {
    if (v !== 0) {
      assert.ok(v === 2 || v === 4);
      if (v > max) max = v;
    }
  }
  assert.equal(state.max_tile, max);
  assert.equal(state.score, 0);
  assert.equal(game.outcome().effective_moves, 0);
  assert.equal(game.outcome().terminal, false);
});

test("2048: same seed and command stream produce identical snapshots", () => {
  const a = createGame(2024001);
  const b = createGame(2024001);
  const stream = ["up", "right", "left", "down", "down", "up", "right", "left", "up", "left", "left", "right"];
  for (const direction of stream) {
    a.dispatch({ type: "move", direction });
    b.dispatch({ type: "move", direction });
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(a.publicState(), b.publicState());
  }
});

test("2048: snapshot and publicState are deep copies (no aliasing)", () => {
  const game = createGame(7);
  const snap = game.snapshot();
  const pub = game.publicState();
  // Mutating the copies must not affect the engine.
  snap.board[0][0] = 999;
  snap.rng = 0;
  pub.board[0][0] = 12345;
  pub.score = 1e9;
  assert.notEqual(game.snapshot().board[0][0], 999);
  assert.notEqual(game.snapshot().rng, 0);
  assert.notEqual(game.publicState().board[0][0], 12345);
  assert.notEqual(game.publicState().score, 1e9);
  // A captured snapshot is immutable: dispatching later does not change it.
  const before = game.snapshot();
  game.dispatch({ type: "move", direction: "left" });
  const after = game.snapshot();
  assert.notDeepEqual(before, after);
});

test("2048: publicState/snapshot are JSON-safe (no undefined anywhere)", () => {
  const trace = playDeterministic(123, 120);
  for (const snap of trace.snapshotTrace) {
    assert.deepEqual(collectUndefined(snap, "snapshot"), []);
  }
  assert.deepEqual(collectUndefined(trace.game.publicState(), "publicState"), []);
  assert.deepEqual(collectUndefined(trace.game.snapshot(), "snapshot"), []);
  const json = JSON.stringify(trace.game.snapshot());
  assert.ok(json.length > 0);
});

test("2048: dispatch rejects malformed and off-contract commands without mutating", () => {
  const game = createGame(5);
  const before = game.snapshot();
  for (const bad of [
    null,
    undefined,
    "move",
    { type: "reveal", row: 0, col: 0 },
    { type: "move", direction: "diagonal" },
    { type: "move" },
    { type: "move", direction: "left", extra: 1 },
  ]) {
    assert.throws(() => game.dispatch(bad));
  }
  assert.deepEqual(game.snapshot(), before);
});

test("2048: only effective moves spawn a tile and count as effective", () => {
  const game = createGame(9);
  const direction = "left";
  let lastEffective = game.outcome().effective_moves;
  let ineffectiveSeen = false;
  for (let i = 0; i < 100; i++) {
    const beforeSum = boardSum(game.publicState().board);
    const result = game.dispatch({ type: "move", direction });
    const afterSum = boardSum(game.publicState().board);
    if (result.changed === true) {
      assert.equal(result.ok, true);
      assert.equal(result.spawned, true);
      // A merge conserves the tile sum, so a changed move increases the sum by
      // exactly the spawned tile's value (2 or 4).
      const spawnedValue = afterSum - beforeSum;
      assert.ok(spawnedValue === 2 || spawnedValue === 4, `spawned value ${spawnedValue}`);
      assert.equal(game.outcome().effective_moves, lastEffective + 1);
      lastEffective = game.outcome().effective_moves;
    } else {
      ineffectiveSeen = true;
      assert.equal(result.changed, false);
      assert.equal(afterSum, beforeSum);
      assert.equal(game.outcome().effective_moves, lastEffective);
    }
  }
  assert.ok(ineffectiveSeen, "expected at least one ineffective move in this sequence");
});

test("2048: slideLine enforces the merge-once rule", () => {
  assert.deepEqual(slideLine([2, 2, 2, 2]).values, [4, 4, 0, 0]);
  assert.equal(slideLine([2, 2, 2, 2]).gained, 8);
  assert.deepEqual(slideLine([2, 2, 2, 0]).values, [4, 2, 0, 0]);
  assert.deepEqual(slideLine([4, 2, 2, 4]).values, [4, 4, 4, 0]);
  assert.equal(slideLine([4, 2, 2, 4]).gained, 4);
  // A freshly merged tile is not re-merged by the same move.
  assert.deepEqual(slideLine([2, 2, 4, 0]).values, [4, 4, 0, 0]);
  assert.deepEqual(slideLine([0, 0, 0, 0]).values, [0, 0, 0, 0]);
  assert.deepEqual(slideLine([8, 8, 8, 8]).values, [16, 16, 0, 0]);
});

test("2048: long deterministic games preserve invariants", () => {
  for (const seed of [1, 2, 3, 99, 2025, 555555]) {
    const { game } = playDeterministic(seed, 300);
    let previousScore = 0;
    const state = game.outcome();
    assert.ok(state.score >= 0);
    assert.ok(state.score >= previousScore);
    const board = game.publicState().board;
    for (const row of board) for (const v of row) {
      if (v === 0) continue;
      assert.ok(v >= 2 && (v & (v - 1)) === 0, `tile value ${v} is not a power of 2`);
      assert.ok(v <= 2048);
    }
    assert.ok(Array.isArray(board) && board.length === 4 && board.every((row) => row.length === 4));
  }
});

test("2048: terminal state = no empty cell and no equal adjacent pair, and is immutable", () => {
  const { game } = playDeterministic(31337, 600);
  const outcome = game.outcome();
  if (outcome.terminal) {
    const board = game.publicState().board;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (board[r][c] === 0) assert.fail("terminal board should have no empty cell");
        if (c + 1 < 4 && board[r][c] === board[r][c + 1]) assert.fail("terminal board should have no horizontal merge");
        if (r + 1 < 4 && board[r][c] === board[r + 1][c]) assert.fail("terminal board should have no vertical merge");
      }
    }
    const before = game.snapshot();
    const result = game.dispatch({ type: "move", direction: "up" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "terminal");
    assert.deepEqual(game.snapshot(), before);
  } else {
    assert.ok(true, "seed did not terminate within the move budget");
  }
});

test("2048: won is false until a 2048 tile exists", () => {
  const game = createGame(77);
  // Cannot force a 2048 tile through the seed-only API; assert the latching
  // invariant holds on the boards we can reach, and that won==false now.
  assert.equal(game.outcome().won, false);
  const maxBefore = game.publicState().max_tile;
  assert.ok(maxBefore < 2048);
  // If, over a long run, we ever reach 2048, won must latch true.
  const { game: longGame } = playDeterministic(424242, 500);
  const longState = longGame.outcome();
  if (longState.max_tile >= 2048) {
    assert.equal(longState.won, true);
  } else {
    assert.equal(longState.won, false);
  }
});
