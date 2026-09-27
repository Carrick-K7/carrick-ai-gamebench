import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findRepositoryRoot, loadPlayTask, writeJson } from "@carrick/gamebench-core";
import { runPlayEpisode } from "../src/play/episode.js";
import { freezePlayReference } from "../src/play/evidence.js";
import { RpcPlayPlayer } from "../src/play/player.js";
import { replayPlayEpisode } from "../src/play/replay.js";
import { quoteCommandArgument as quote } from "../src/campaign-v2-io.js";

for (const game of ["2048", "minesweeper"] as const) {
  test(`real Pi adapter → fake Pi RPC → native ${game} → sealed replay`, async () => {
    const repository = await findRepositoryRoot();
    const root = await mkdtemp(path.join(os.tmpdir(), "cagb-pi-native-"));
    try {
      const auth = path.join(root, "auth");
      const cwd = path.join(root, "empty");
      await mkdir(auth, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
      const isolation = path.join(root, "isolation.json");
      const task = await freezePlayReference(await loadPlayTask(`play.${game}.v1`, repository), path.join(root, "task"));
      const action = game === "2048" ? { type: "key", key: "ArrowUp" } : { type: "click", button: "left", x: 435, y: 174 };
      const responses = [JSON.stringify({ action, memo: "bounded-memory" }), "invalid", "invalid", "invalid"];
      const command = [
        `PI_BIN=${quote(path.join(repository, "tools/agents/pi-play.fake-pi.mjs"))}`,
        `PI_CODING_AGENT_DIR_ORIGINAL=${quote(auth)}`, `PI_FAKE_ISOLATION_LOG=${quote(isolation)}`,
        `PI_FAKE_RESPONSES=${quote(JSON.stringify(responses))}`,
        quote(process.execPath), quote(path.join(repository, "tools/agents/pi-play.mjs")), "deepseek", "fixture", "off",
      ].join(" ");
      const episodeRoot = path.join(root, "task", "episodes", "000");
      const recorded = await runPlayEpisode({ task, episodeRoot, episodeIndex: 0, seed: 42, promptLanguage: "en", createPlayer: async () => {
        const player = new RpcPlayPlayer({ command, cwd, stderrPath: path.join(episodeRoot, "adapter.stderr.log") });
        try {
          const identity = await player.init(game, { agent: "pi", version: "0.84.3", provider: "deepseek", model: "fixture", thinking: "off" });
          await writeJson(path.join(episodeRoot, "player.json"), identity);
          return player;
        } catch (error) { await player.close(); throw error; }
      } });
      assert.equal(recorded.summary.status, "complete");
      assert.equal(recorded.episode?.decisions[0]?.status, "action");
      assert.equal(recorded.episode?.decisions[0]?.engine_commands.length, 1);
      const replay = await replayPlayEpisode({ task, episodeRoot, mode: "browser", expectedSeal: recorded.seal_hash });
      assert.equal(replay.valid, true, replay.errors.join("; "));
      const isolated = JSON.parse(await readFile(isolation, "utf8"));
      assert.deepEqual(isolated.cwdEntries, []);
      assert.notEqual(isolated.cwd, isolated.agentDir);
      await assert.rejects(stat(isolated.cwd)); await assert.rejects(stat(isolated.agentDir));
      assert.equal((await readFile(path.join(episodeRoot, "adapter.stderr.log"), "utf8")).includes("private-thinking-canary"), false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
