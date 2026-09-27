/**
 * Minesweeper reference renderer (Play contract).
 *
 *   mountGame(root, { onCommand }) -> { render(publicState), destroy() }
 *   nativeActionForCommand(command) -> native key/pointer payload
 *   GEOMETRY                         -> fixed 1280x720 DPR-1 layout constants
 *
 * The renderer maps real native pointer events to engine commands via
 * `onCommand` (left click = reveal, right click = flag). It never owns or
 * resets the engine and never exposes a privileged Bridge. `mountGame` does
 * no animation and no wall-clock work. The scene uses a fixed pixel origin so
 * that `nativeActionForCommand` returns exactly the cell-center click a
 * scripted player must issue to reproduce the same command stream.
 */

export const GEOMETRY = {
  viewport: { width: 1280, height: 720 },
  origin: { x: 411, y: 150 },
  cellSize: 44,
  gap: 2,
  rows: 10,
  cols: 10,
};
const CELL = GEOMETRY.cellSize;
const GAP = GEOMETRY.gap;
const ORIGIN = GEOMETRY.origin;

const NUMBER_COLORS = {
  1: "#0000ff",
  2: "#008000",
  3: "#ff0000",
  4: "#000080",
  5: "#800000",
  6: "#008080",
  7: "#000000",
  8: "#808080",
};

function cellLeft(col) {
  return ORIGIN.x + GAP + col * (CELL + GAP);
}
function cellTop(row) {
  return ORIGIN.y + GAP + row * (CELL + GAP);
}
function cellCenter(col) {
  return cellLeft(col) + CELL / 2;
}
function cellCenterY(row) {
  return cellTop(row) + CELL / 2;
}

/** Returns the approved native click payload for a reveal/flag command. */
export function nativeActionForCommand(command) {
  if (!command || (command.type !== "reveal" && command.type !== "flag")) {
    throw new Error("minesweeper nativeActionForCommand expects reveal/flag command");
  }
  const { row, col } = command;
  if (
    !Number.isInteger(row) || !Number.isInteger(col) ||
    row < 0 || row >= GEOMETRY.rows || col < 0 || col >= GEOMETRY.cols
  ) {
    throw new Error(`invalid minesweeper cell: (${String(row)},${String(col)})`);
  }
  return {
    type: "click",
    button: command.type === "reveal" ? "left" : "right",
    x: cellCenter(col),
    y: cellCenterY(row),
  };
}

function svgElement(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

function makeFlagIcon() {
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(Math.round(CELL * 0.62)));
  svg.setAttribute("height", String(Math.round(CELL * 0.62)));
  svg.style.cssText = "display:block";
  const pole = svgElement("rect");
  pole.setAttribute("x", "5");
  pole.setAttribute("y", "3");
  pole.setAttribute("width", "2.4");
  pole.setAttribute("height", "18");
  pole.setAttribute("fill", "#3a3a3a");
  const flag = svgElement("polygon");
  flag.setAttribute("points", "7.4,4 20,7 7.4,14");
  flag.setAttribute("fill", "#d32f2f");
  svg.appendChild(pole);
  svg.appendChild(flag);
  return svg;
}

function makeMineIcon() {
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(Math.round(CELL * 0.66)));
  svg.setAttribute("height", String(Math.round(CELL * 0.66)));
  svg.style.cssText = "display:block";
  const ball = svgElement("circle");
  ball.setAttribute("cx", "12");
  ball.setAttribute("cy", "12");
  ball.setAttribute("r", "6");
  ball.setAttribute("fill", "#111111");
  for (const [x1, y1, x2, y2] of [
    [12, 2, 12, 5],
    [12, 19, 12, 22],
    [2, 12, 5, 12],
    [19, 12, 22, 12],
    [5, 5, 7.5, 7.5],
    [16.5, 16.5, 19, 19],
    [16.5, 7.5, 19, 5],
    [5, 16.5, 7.5, 19],
  ]) {
    const spike = svgElement("line");
    spike.setAttribute("x1", String(x1));
    spike.setAttribute("y1", String(y1));
    spike.setAttribute("x2", String(x2));
    spike.setAttribute("y2", String(y2));
    spike.setAttribute("stroke", "#111111");
    spike.setAttribute("stroke-width", "2");
    svg.appendChild(spike);
  }
  svg.appendChild(ball);
  return svg;
}

export function mountGame(root, { onCommand }) {
  if (!root || typeof root.appendChild !== "function") {
    throw new Error("mountGame requires a DOM root element");
  }
  if (typeof onCommand !== "function") {
    throw new Error("mountGame requires an onCommand callback");
  }

  root.style.cssText = [
    "position:relative",
    "width:" + GEOMETRY.viewport.width + "px",
    "height:" + GEOMETRY.viewport.height + "px",
    "overflow:hidden",
    "box-sizing:border-box",
    "background:#e6e6e6",
    "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    "user-select:none",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText = [
    "position:absolute",
    "top:28px",
    "left:0",
    "width:100%",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:28px",
  ].join(";");

  const minesBox = makeHeaderBox("MINES", "10");
  const statusBox = makeHeaderBox("STATUS", "Playing");
  header.appendChild(minesBox.box);
  header.appendChild(statusBox.box);
  root.appendChild(header);

  const board = document.createElement("div");
  board.style.cssText = [
    "position:absolute",
    "left:" + ORIGIN.x + "px",
    "top:" + ORIGIN.y + "px",
    "width:" + (GEOMETRY.cols * CELL + (GEOMETRY.cols + 1) * GAP) + "px",
    "height:" + (GEOMETRY.rows * CELL + (GEOMETRY.rows + 1) * GAP) + "px",
    "background:#9e9e9e",
  ].join(";");

  const cellEls = [];
  for (let r = 0; r < GEOMETRY.rows; r++) {
    for (let c = 0; c < GEOMETRY.cols; c++) {
      const cell = document.createElement("div");
      cell.style.cssText = [
        "position:absolute",
        "left:" + (GAP + c * (CELL + GAP)) + "px",
        "top:" + (GAP + r * (CELL + GAP)) + "px",
        "width:" + CELL + "px",
        "height:" + CELL + "px",
        "box-sizing:border-box",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font-weight:700",
        "font-size:1.6rem",
        "line-height:1",
      ].join(";");
      cell.addEventListener("mousedown", (event) => {
        event.preventDefault();
        // Deliver exactly one command per event, and tolerate an async onCommand.
        if (event.button === 2) fireCommand({ type: "flag", row: r, col: c });
        else if (event.button === 0) fireCommand({ type: "reveal", row: r, col: c });
      });
      cell.addEventListener("contextmenu", (event) => event.preventDefault());
      board.appendChild(cell);
      cellEls.push({ el: cell, r, c, icon: null });
    }
  }
  root.appendChild(board);

  function fireCommand(command) {
    const result = onCommand(command);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  function makeHeaderBox(label, initial) {
    const box = document.createElement("div");
    box.style.cssText = [
      "background:#c6c6c6",
      "border:2px inset #fff",
      "padding:6px 12px",
      "text-align:center",
      "min-width:96px",
    ].join(";");
    const labelEl = document.createElement("div");
    labelEl.textContent = label;
    labelEl.style.cssText = "font-size:0.72rem;color:#444;letter-spacing:1px;";
    const value = document.createElement("div");
    value.textContent = initial;
    value.style.cssText = "font-size:1.15rem;font-weight:700;color:#222;";
    box.appendChild(labelEl);
    box.appendChild(value);
    return { box, value };
  }

  function setCellStyle(el, style) {
    el.style.background = style.background;
    el.style.border = style.border;
  }

  function render(state) {
    if (!state || !Array.isArray(state.cells) || state.cells.length !== GEOMETRY.rows) {
      throw new Error("minesweeper renderer: publicState.cells must be a 10x10 array");
    }
    for (const entry of cellEls) {
      const cell = state.cells[entry.r][entry.c];
      const el = entry.el;
      // clear any icon
      if (entry.icon) {
        entry.icon.remove();
        entry.icon = null;
      }
      el.textContent = "";
      if (cell.state === "hidden") {
        setCellStyle(el, {
          background: "#c6c6c6",
          border: "3px outset #f2f2f2",
        });
      } else if (cell.state === "flagged") {
        setCellStyle(el, {
          background: "#c6c6c6",
          border: "3px outset #f2f2f2",
        });
        entry.icon = makeFlagIcon();
        el.appendChild(entry.icon);
      } else if (cell.state === "revealed") {
        if (cell.mine === true) {
          setCellStyle(el, {
            background: "#e6e6e6",
            border: "3px solid #c0c0c0",
          });
          entry.icon = makeMineIcon();
          el.appendChild(entry.icon);
        } else {
          const adjacent = cell.adjacent;
          setCellStyle(el, {
            background: "#dedede",
            border: "3px solid #c0c0c0",
          });
          if (adjacent > 0) {
            el.textContent = String(adjacent);
            el.style.color = NUMBER_COLORS[adjacent] ?? "#000";
          }
        }
      }
    }
    minesBox.value.textContent = String(state.remaining_mines ?? 0);
    let status = "Playing";
    if (state.won) status = "You win!";
    else if (state.terminal && state.state === "lost") status = "Boom!";
    statusBox.value.textContent = status;
  }

  function onContextMenu(event) {
    event.preventDefault();
  }
  document.addEventListener("contextmenu", onContextMenu);

  function destroy() {
    document.removeEventListener("contextmenu", onContextMenu);
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  return { render, destroy };
}
