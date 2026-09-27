/**
 * 2048 reference renderer (Play contract).
 *
 *   mountGame(root, { onCommand }) -> { render(publicState), destroy() }
 *   nativeActionForCommand(command) -> native key/pointer payload
 *
 * The renderer maps real native keyboard events to engine commands via
 * `onCommand`. It never owns or resets the engine and never exposes any
 * privileged Bridge. `mountGame` performs no animation and no wall-clock work;
 * it only builds DOM and dispatches commands. The scene is laid out for the
 * fixed 1280x720 DPR-1 viewport used by the Play instrument, and
 * `nativeActionForCommand` returns the exact key payload a scripted player
 * sends to reproduce the same command stream.
 */

const KEY_DIRECTION = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

const TILE_BACKGROUND = {
  2: "#eee4da",
  4: "#ede0c8",
  8: "#f2b179",
  16: "#f59563",
  32: "#f67c5f",
  64: "#f65e3b",
  128: "#edcf72",
  256: "#edcc61",
  512: "#edc850",
  1024: "#edc53f",
  2048: "#edc22e",
};
const DARK_TEXT = "#776e65";
const LIGHT_TEXT = "#f9f6f2";

function tileStyle(value) {
  const background = TILE_BACKGROUND[value] ?? "#3c3a32";
  const color = value <= 4 ? DARK_TEXT : LIGHT_TEXT;
  let fontSize = "3rem";
  if (value >= 1000) fontSize = "2.1rem";
  else if (value >= 100) fontSize = "2.6rem";
  else if (value >= 10) fontSize = "2.9rem";
  return { background, color, fontSize };
}

/** Returns the approved native key payload for a 2048 move command. */
export function nativeActionForCommand(command) {
  if (!command || command.type !== "move") {
    throw new Error("2048 nativeActionForCommand expects a move command");
  }
  const direction = command.direction;
  if (!KEY_DIRECTION_SUPPORTED.has(direction)) {
    throw new Error(`unsupported 2048 direction: ${String(direction)}`);
  }
  const key = ARROW_KEY[direction];
  return { type: "key", key };
}

const ARROW_KEY = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};
const KEY_DIRECTION_SUPPORTED = new Set(["up", "down", "left", "right"]);

export function mountGame(root, { onCommand }) {
  if (!root || typeof root.appendChild !== "function") {
    throw new Error("mountGame requires a DOM root element");
  }
  if (typeof onCommand !== "function") {
    throw new Error("mountGame requires an onCommand callback");
  }

  root.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "height:100%",
    "width:100%",
    "box-sizing:border-box",
    "background:#faf8ef",
    "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    "user-select:none",
    "overflow:hidden",
  ].join(";");

  const size = 4;
  const cell = 104;
  const gap = 12;
  const boardSize = size * cell + (size - 1) * gap;

  const header = document.createElement("div");
  header.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "width:" + boardSize + "px",
    "margin-bottom:24px",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "2048";
  title.style.cssText = "font-size:3rem;font-weight:700;color:#776e65;line-height:1;";
  header.appendChild(title);

  const scorePanel = document.createElement("div");
  scorePanel.style.cssText = [
    "display:flex",
    "gap:12px",
  ].join(";");

  const scoreBox = makeScoreBox("SCORE", "0");
  scoreBox.value.textContent = "0";
  const bestBox = makeScoreBox("MAX", "0");
  bestBox.value.textContent = "0";
  scorePanel.appendChild(scoreBox.box);
  scorePanel.appendChild(bestBox.box);
  header.appendChild(scorePanel);
  root.appendChild(header);

  const boardEl = document.createElement("div");
  boardEl.style.cssText = [
    "display:grid",
    "grid-template-columns:repeat(" + size + "," + cell + "px)",
    "grid-template-rows:repeat(" + size + "," + cell + "px)",
    "gap:" + gap + "px",
    "padding:" + gap + "px",
    "background:#bbada0",
    "border-radius:12px",
    "box-sizing:content-box",
  ].join(";");

  const tileEls = [];
  for (let i = 0; i < size * size; i++) {
    const tile = document.createElement("div");
    tile.style.cssText = [
      "width:" + cell + "px",
      "height:" + cell + "px",
      "border-radius:8px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-weight:700",
      "background:#cdc1b4",
      "color:" + DARK_TEXT,
    ].join(";");
    boardEl.appendChild(tile);
    tileEls.push(tile);
  }
  root.appendChild(boardEl);

  const status = document.createElement("div");
  status.style.cssText = [
    "margin-top:24px",
    "font-size:1.1rem",
    "color:#776e65",
    "height:1.4em",
  ].join(";");
  root.appendChild(status);

  function makeScoreBox(label, initial) {
    const box = document.createElement("div");
    box.style.cssText = [
      "background:#bbada0",
      "border-radius:6px",
      "padding:8px 14px",
      "text-align:center",
      "min-width:60px",
    ].join(";");
    const labelEl = document.createElement("div");
    labelEl.textContent = label;
    labelEl.style.cssText = "font-size:0.7rem;color:#eee4da;letter-spacing:1px;";
    const value = document.createElement("div");
    value.textContent = initial;
    value.style.cssText = "font-size:1.3rem;font-weight:700;color:#f9f6f2;line-height:1.1;";
    box.appendChild(labelEl);
    box.appendChild(value);
    return { box, value };
  }

  function render(state) {
    if (!state || !Array.isArray(state.board) || state.board.length !== size) {
      throw new Error("2048 renderer: publicState.board must be a 4x4 array");
    }
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const value = state.board[r][c];
        const tile = tileEls[r * size + c];
        const s = tileStyle(value);
        tile.textContent = value === 0 ? "" : String(value);
        tile.style.background = s.background;
        tile.style.color = s.color;
        tile.style.fontSize = s.fontSize;
      }
    }
    scoreBox.value.textContent = String(state.score ?? 0);
    bestBox.value.textContent = String(state.max_tile ?? 0);
    if (state.won) {
      status.textContent = "You win!";
    } else if (state.terminal) {
      status.textContent = "Game over.";
    } else {
      status.textContent = "";
    }
  }

  function onKeyDown(event) {
    const direction = KEY_DIRECTION[event.key];
    if (!direction) return;
    event.preventDefault();
    // Deliver exactly one command per event, and tolerate an async onCommand.
    fireCommand({ type: "move", direction });
  }

  function fireCommand(command) {
    const result = onCommand(command);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  // Listen at the document level so arrow keys reach the game regardless of
  // which element currently holds focus (safe for automated native input).
  document.addEventListener("keydown", onKeyDown, true);

  function destroy() {
    document.removeEventListener("keydown", onKeyDown, true);
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  return { render, destroy };
}
