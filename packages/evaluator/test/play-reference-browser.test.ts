import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { findRepositoryRoot } from "@carrick/gamebench-core";
import { PlayBrowser, PlayEngineClient, type NativePlayAction } from "../src/play/engine-host.js";
import type { EngineCommand } from "../src/play/engine-protocol.js";

for (const game of ["2048", "minesweeper"] as const) {
  test(`${game} reference native input matches independent engine replay`, async () => {
    const root = path.join(await findRepositoryRoot(), "benchmark", "play", game, "v1");
    const renderer = await import(pathToFileURL(path.join(root, "renderer.mjs")).href) as {
      nativeActionForCommand: (command: EngineCommand) => NativePlayAction;
    };
    const commands: EngineCommand[] = game === "2048"
      ? ["left", "up", "down", "right", "left"].map((direction) => ({ type: "move", direction } as EngineCommand))
      : [
          { type: "flag", row: 4, col: 4 },
          { type: "flag", row: 4, col: 4 },
          { type: "reveal", row: 4, col: 4 },
          { type: "flag", row: 0, col: 0 },
          { type: "reveal", row: 0, col: 1 },
        ];
    const enginePath = path.join(root, "engine.mjs");
    const expected = new PlayEngineClient();
    let browser: PlayBrowser | undefined;
    try {
      const initial = await expected.init(enginePath, 42);
      browser = await PlayBrowser.start({ enginePath, rendererPath: path.join(root, "renderer.mjs"), game, seed: 42 });
      assert.deepEqual((await browser.snapshot()).snapshot, initial.snapshot);
      const initialFrame = await browser.frame();
      for (const command of commands) {
        const actual = await browser.act(renderer.nativeActionForCommand(command));
        assert.deepEqual(actual.commands, [command], "one native action must create exactly the intended engine command");
        const target = await expected.dispatch(command);
        assert.deepEqual(actual.view.snapshot, target.snapshot);
        assert.deepEqual(actual.view.outcome, target.outcome);
      }
      assert.notDeepEqual(await browser.frame(), initialFrame, "observed input must also change the rendered frame");
      const final = await expected.observe();
      assert.ok(game === "2048" ? final.outcome.effective_moves! > 0 : final.outcome.revealed_safe! > 0);
    } finally {
      await browser?.close();
      await expected.close();
    }
  });
}
