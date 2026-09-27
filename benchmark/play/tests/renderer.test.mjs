import assert from "node:assert/strict";
import test from "node:test";
import { mountGame as mount2048, nativeActionForCommand as native2048 } from "../2048/v1/renderer.mjs";
import { mountGame as mountMinesweeper, nativeActionForCommand as nativeMines, GEOMETRY } from "../minesweeper/v1/renderer.mjs";

test("renderers: modules import in Node without a DOM and export the contract", () => {
  assert.equal(typeof mount2048, "function");
  assert.equal(typeof mountMinesweeper, "function");
  assert.equal(typeof GEOMETRY, "object");
});

test("2048: nativeActionForCommand maps each direction to its arrow key", () => {
  const expected = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };
  for (const [direction, key] of Object.entries(expected)) {
    assert.deepEqual(native2048({ type: "move", direction }), { type: "key", key });
  }
});

test("2048: nativeActionForCommand rejects invalid commands", () => {
  for (const bad of [
    null,
    { type: "reveal", row: 0, col: 0 },
    { type: "move", direction: "diagonal" },
    { type: "move" },
  ]) {
    assert.throws(() => native2048(bad));
  }
});

test("minesweeper: GEOMETRY matches the 1280x720 DPR-1 viewport", () => {
  assert.equal(GEOMETRY.viewport.width, 1280);
  assert.equal(GEOMETRY.viewport.height, 720);
  assert.equal(GEOMETRY.rows, 10);
  assert.equal(GEOMETRY.cols, 10);
  const pitch = GEOMETRY.cellSize + GEOMETRY.gap;
  // The board must fit inside the viewport.
  const boardWidth = GEOMETRY.cols * GEOMETRY.cellSize + (GEOMETRY.cols + 1) * GEOMETRY.gap;
  const boardHeight = GEOMETRY.rows * GEOMETRY.cellSize + (GEOMETRY.rows + 1) * GEOMETRY.gap;
  assert.ok(GEOMETRY.origin.x + boardWidth <= GEOMETRY.viewport.width);
  assert.ok(GEOMETRY.origin.y + boardHeight <= GEOMETRY.viewport.height);
  assert.equal(boardWidth, boardHeight);
  assert.ok(pitch > GEOMETRY.cellSize);
});

test("minesweeper: nativeActionForCommand returns exact cell-center pixels and buttons", () => {
  const cellSize = GEOMETRY.cellSize;
  const gap = GEOMETRY.gap;
  const pitch = cellSize + gap;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const centerX = GEOMETRY.origin.x + gap + c * pitch + cellSize / 2;
      const centerY = GEOMETRY.origin.y + gap + r * pitch + cellSize / 2;
      assert.deepEqual(nativeMines({ type: "reveal", row: r, col: c }), {
        type: "click",
        button: "left",
        x: centerX,
        y: centerY,
      });
      assert.deepEqual(nativeMines({ type: "flag", row: r, col: c }), {
        type: "click",
        button: "right",
        x: centerX,
        y: centerY,
      });
      // The center must lie inside the cell rectangle (per-cell click target).
      const cellLeft = GEOMETRY.origin.x + gap + c * pitch;
      const cellTop = GEOMETRY.origin.y + gap + r * pitch;
      assert.ok(centerX >= cellLeft && centerX <= cellLeft + cellSize);
      assert.ok(centerY >= cellTop && centerY <= cellTop + cellSize);
      // And inside the viewport.
      assert.ok(centerX >= 0 && centerX <= 1280);
      assert.ok(centerY >= 0 && centerY <= 720);
    }
  }
});

test("minesweeper: nativeActionForCommand rejects invalid cells and commands", () => {
  for (const bad of [
    null,
    { type: "move", direction: "up" },
    { type: "reveal", row: -1, col: 0 },
    { type: "reveal", row: 0, col: 10 },
    { type: "flag", row: 0.5, col: 0 },
    { type: "reveal", row: 0, col: "x" },
  ]) {
    assert.throws(() => nativeMines(bad));
  }
});

test("minesweeper: consecutive cell centers differ by the cell pitch", () => {
  const pitch = GEOMETRY.cellSize + GEOMETRY.gap;
  const a = nativeMines({ type: "reveal", row: 0, col: 0 });
  const b = nativeMines({ type: "reveal", row: 0, col: 1 });
  const c = nativeMines({ type: "reveal", row: 1, col: 0 });
  assert.equal(b.x - a.x, pitch);
  assert.equal(c.y - a.y, pitch);
});
