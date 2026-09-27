import assert from "node:assert/strict";
import test from "node:test";

/**
 * Minimal DOM shim so the browser-only renderers can be smoke-tested in Node.
 * This is NOT a full DOM; it only supports the small surface the renderers
 * use (createElement/createElementNS, add/removeEventListener, append/remove,
 * style, textContent, setAttribute). Real geometry/layout is verified by the
 * parent's browser harness; here we only check the renderer wiring.
 */

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parent = null;
    this.style = {};
    this.textContent = "";
    this.attributes = {};
    this.listeners = new Map();
    this.tabIndex = undefined;
  }
  appendChild(child) {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
    return child;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  remove() {
    if (this.parent) this.parent.removeChild(this);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
    if (handlers.length === 0) this.listeners.delete(type);
  }
  dispatch(type, event) {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(event);
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
  }
  createElement(tag) {
    return new FakeElement(tag);
  }
  createElementNS(_ns, tag) {
    return new FakeElement(tag);
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
    if (handlers.length === 0) this.listeners.delete(type);
  }
  dispatch(type, event) {
    const handlers = this.listeners.get(type);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(event);
  }
}

function installShim() {
  const doc = new FakeDocument();
  globalThis.document = doc;
  return doc;
}

function makePublic2048(stateOverrides = {}) {
  return {
    board: [
      [2, 0, 0, 4],
      [0, 0, 0, 0],
      [8, 0, 0, 0],
      [0, 0, 64, 0],
    ],
    score: 1234,
    max_tile: 64,
    terminal: false,
    won: false,
    ...stateOverrides,
  };
}

function makePublicMinesweeper(stateOverrides = {}) {
  const cells = Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => ({ state: "hidden" })),
  );
  cells[0][0] = { state: "revealed", adjacent: 0 };
  cells[0][1] = { state: "revealed", adjacent: 1 };
  cells[5][5] = { state: "flagged" };
  return {
    rows: 10,
    cols: 10,
    mine_count: 10,
    cells,
    revealed: 2,
    flags: 1,
    remaining_mines: 9,
    state: "playing",
    terminal: false,
    won: false,
    ...stateOverrides,
  };
}

test("2048 renderer: mount, render, input, and destroy", async () => {
  const doc = installShim();
  const root = new FakeElement("div");
  const commands = [];
  const game = (await import("../2048/v1/renderer.mjs")).mountGame(root, {
    onCommand: (command) => commands.push(command),
  });
  assert.equal(typeof game.render, "function");
  assert.equal(typeof game.destroy, "function");

  game.render(makePublic2048());
  // 16 tile elements, a header with SCORE/MAX, and a status line.
  assert.equal(root.children.length, 3);
  const tiles = root.children[1].children;
  assert.equal(tiles.length, 16);
  assert.equal(tiles[0].textContent, "2");
  assert.equal(tiles[3].textContent, "4");
  // score box shows the score.
  const scorePanel = root.children[0].children[1];
  assert.equal(scorePanel.children[0].children[1].textContent, "1234");

  // A document-level ArrowUp keydown should emit a move command.
  doc.dispatch("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.deepEqual(commands, [{ type: "move", direction: "up" }]);
  doc.dispatch("keydown", { key: "s", preventDefault() {} });
  assert.deepEqual(commands[1], { type: "move", direction: "down" });

  game.destroy();
  assert.equal(root.children.length, 0);
});

test("minesweeper renderer: mount, render, input, and destroy", async () => {
  const doc = installShim();
  const root = new FakeElement("div");
  const commands = [];
  const game = (await import("../minesweeper/v1/renderer.mjs")).mountGame(root, {
    onCommand: (command) => commands.push(command),
  });
  assert.equal(typeof game.render, "function");
  assert.equal(typeof game.destroy, "function");

  game.render(makePublicMinesweeper());
  assert.equal(root.children.length, 2); // header + board
  const board = root.children[1];
  const cells = board.children;
  assert.equal(cells.length, 100);
  // Left-click cell (r=0,c=2) should reveal it.
  cells[0 * 10 + 2].dispatch("mousedown", { button: 0, preventDefault() {} });
  assert.deepEqual(commands[0], { type: "reveal", row: 0, col: 2 });
  // Right-click cell (r=4,c=4) should flag it.
  cells[4 * 10 + 4].dispatch("mousedown", { button: 2, preventDefault() {} });
  assert.deepEqual(commands[1], { type: "flag", row: 4, col: 4 });

  // The flags counter reads from publicState.
  const headerBoxes = root.children[0].children;
  assert.equal(headerBoxes[0].children[1].textContent, "9");
  assert.equal(headerBoxes[1].children[1].textContent, "Playing");

  game.destroy();
  assert.equal(root.children.length, 0);
});

test("2048 renderer: async onCommand is tolerated and nothing is drawn before publicState", async () => {
  const doc = installShim();
  const root = new FakeElement("div");
  const commands = [];
  const rejected = [];
  const onRejection = (reason) => rejected.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    const game = (await import("../2048/v1/renderer.mjs")).mountGame(root, {
      onCommand: async (command) => {
        commands.push(command);
        throw new Error("host rejected");
      },
    });
    // No initial render before publicState arrives.
    const tilesBefore = root.children[1].children;
    assert.equal(tilesBefore[0].textContent, "");
    assert.equal(tilesBefore[3].textContent, "");
    // Each event delivers one command; a rejected async onCommand is swallowed.
    doc.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
    assert.deepEqual(commands, [{ type: "move", direction: "right" }]);
    game.destroy();
  } finally {
    process.removeListener("unhandledRejection", onRejection);
  }
  assert.deepEqual(rejected, []);
});

test("minesweeper renderer: async onCommand is tolerated and nothing is drawn before publicState", async () => {
  const doc = installShim();
  const root = new FakeElement("div");
  const commands = [];
  const rejected = [];
  const onRejection = (reason) => rejected.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    const game = (await import("../minesweeper/v1/renderer.mjs")).mountGame(root, {
      onCommand: async (command) => {
        commands.push(command);
        throw new Error("host rejected");
      },
    });
    // Before publicState arrives, cells are drawn with no game content.
    const cellsBefore = root.children[1].children;
    assert.equal(cellsBefore.length, 100);
    assert.equal(cellsBefore[5].textContent, "");
    cellsBefore[7].dispatch("mousedown", { button: 0, preventDefault() {} });
    assert.deepEqual(commands, [{ type: "reveal", row: 0, col: 7 }]);
    cellsBefore[9].dispatch("mousedown", { button: 2, preventDefault() {} });
    assert.deepEqual(commands[1], { type: "flag", row: 0, col: 9 });
    game.destroy();
  } finally {
    process.removeListener("unhandledRejection", onRejection);
  }
  assert.deepEqual(rejected, []);
});
