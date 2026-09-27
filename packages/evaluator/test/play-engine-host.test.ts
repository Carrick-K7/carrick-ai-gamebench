import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PlayBrowser, PlayEngineClient, validateNativeAction } from "../src/play/engine-host.js";
import { parseEngineCommand } from "../src/play/engine-protocol.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-host-"));
  await writeFile(path.join(root, "engine.mjs"), `
export function createGame(seed) {
  let moves = 0;
  return {
    dispatch(command) { if (command.type !== 'move') throw new Error('wrong command'); moves++; },
    publicState() { return { moves, label: 'visible game state' }; },
    snapshot() { return { private_seed: seed, moves, credential_leaked: Boolean(process.env.CAGB_PLAY_TEST_SECRET) }; },
    outcome() { return { terminal: moves >= 3, won: false, score: moves * 4 }; }
  };
}`);
  await writeFile(path.join(root, "renderer.mjs"), `
export function mountGame(root, {onCommand}) {
  const directions = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
  const handler = event => {
    if (directions[event.key]) {
      event.preventDefault();
      void onCommand({type:'move',direction:directions[event.key]});
    }
  };
  window.addEventListener('keydown', handler);
  return {
    render(state) { root.textContent = 'Score moves: ' + state.moves; },
    destroy() { window.removeEventListener('keydown', handler); }
  };
}`);
  return root;
}

test("Play command boundary excludes reset, peeking, malformed cells and arbitrary keys", () => {
  assert.deepEqual(parseEngineCommand({ type: "move", direction: "left" }, "2048"), { type: "move", direction: "left" });
  for (const input of [null, [], { type: "reset" }, { type: "snapshot" }, { type: "move", direction: "left", seed: 1 }]) {
    assert.throws(() => parseEngineCommand(input, "2048"));
  }
  assert.throws(() => parseEngineCommand({ type: "reveal", row: -1, col: 0 }, "minesweeper"));
  assert.throws(() => parseEngineCommand({ type: "reveal", row: 1.5, col: 0 }, "minesweeper"));
  assert.throws(() => validateNativeAction({ type: "key", key: "F12" } as never));
  assert.throws(() => validateNativeAction({ type: "click", button: "left", x: 1280, y: 1 }));
  assert.throws(() => validateNativeAction({ type: "click", button: "right", x: 1, y: -1 }));
});

test("private engine worker strips provider-like environment and cannot reset", async () => {
  const root = await fixture();
  const old = process.env.CAGB_PLAY_TEST_SECRET;
  process.env.CAGB_PLAY_TEST_SECRET = "must-not-reach-game";
  const engine = new PlayEngineClient();
  try {
    const initial = await engine.init(path.join(root, "engine.mjs"), 987654321);
    assert.deepEqual(initial.public_state, { moves: 0, label: "visible game state" });
    assert.deepEqual(initial.snapshot, { private_seed: 987654321, moves: 0, credential_leaked: false });
    await assert.rejects(engine.init(path.join(root, "engine.mjs"), 1), /cannot be reset/);
    const next = await engine.dispatch({ type: "move", direction: "left" });
    assert.equal(next.outcome.score, 4);
    assert.deepEqual(await engine.observe(), next);
  } finally {
    if (old === undefined) delete process.env.CAGB_PLAY_TEST_SECRET;
    else process.env.CAGB_PLAY_TEST_SECRET = old;
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native Play browser records real keys, paints state and does not serve private files", async () => {
  const root = await fixture();
  let browser: PlayBrowser | undefined;
  try {
    browser = await PlayBrowser.start({
      enginePath: path.join(root, "engine.mjs"), rendererPath: path.join(root, "renderer.mjs"),
      game: "2048", seed: 987654321,
    });
    const initial = await browser.frame();
    assert.deepEqual([...initial.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const key = await browser.act({ type: "key", key: "ArrowLeft" });
    assert.deepEqual(key.commands, [{ type: "move", direction: "left" }]);
    assert.equal(key.view.outcome.score, 4);
    assert.notDeepEqual(await browser.frame(), initial);
    const click = await browser.act({ type: "click", button: "left", x: 1200, y: 650 });
    assert.deepEqual(click.commands, []);
    assert.equal(click.view.outcome.score, 4);
    const html = await (await fetch(browser.url)).text();
    assert.ok(!html.includes("987654321"));
    assert.ok(!html.includes("private_seed"));
    for (const endpoint of ["/engine.mjs", "/snapshot", "/seed", "/state", "/task.yml"]) {
      const response: Response = await fetch(`${browser.url}${endpoint}`);
      assert.equal(response.status, 403);
      assert.ok(!(await response.text()).includes("987654321"));
    }
    const attack = await fetch(`${browser.url}/input`, { method: "POST", body: JSON.stringify({ type: "reset", seed: 1 }) });
    assert.equal(attack.status, 403);
    assert.equal((await browser.snapshot()).outcome.score, 4);
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});
