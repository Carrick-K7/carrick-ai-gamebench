import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadPlayTasks } from "@carrick/gamebench-core";
import { PlayBrowser } from "./engine-host.js";
import { freezePlayReference } from "./evidence.js";
import { RpcPlayPlayer, type PlayPlayerIdentity } from "./player.js";

/** Control-plane-only startup. Never calls observe/prompt or a paid model. */
export async function probePlayPlayer(command: string, expected?: PlayPlayerIdentity): Promise<PlayPlayerIdentity> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-probe-"));
  let player: RpcPlayPlayer | undefined;
  try {
    const cwd = path.join(root, "empty");
    await mkdir(cwd, { mode: 0o700 });
    player = new RpcPlayPlayer({ command, cwd, stderrPath: path.join(root, "stderr.log") });
    return await player.init("2048", expected);
  } finally {
    try { await player?.close(); } finally { await rm(root, { recursive: true, force: true }); }
  }
}

export async function runPlayDoctor(repositoryRoot: string, checkAdapter = true): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-play-doctor-"));
  try {
    for (const original of await loadPlayTasks(repositoryRoot)) {
      const task = await freezePlayReference(original, path.join(root, original.manifest.id));
      const browser = await PlayBrowser.start({ enginePath: path.join(task.root, task.manifest.engine), rendererPath: path.join(task.root, task.manifest.renderer), game: task.manifest.game, seed: 0 });
      try {
        const frame = await browser.frame();
        if (frame.readUInt32BE(16) !== 1280 || frame.readUInt32BE(20) !== 720) throw new Error("Play screenshot viewport is not 1280×720");
        const applied = await browser.act(task.manifest.game === "2048" ? { type: "key", key: "ArrowLeft" } : { type: "click", button: "left", x: 435, y: 174 });
        if (applied.commands.length !== 1) throw new Error("native input did not produce exactly one reference command");
        if (task.manifest.game === "minesweeper" && applied.view.outcome.revealed_safe === 0) throw new Error("first Minesweeper click did not reveal a safe cell");
      } finally { await browser.close(); }
    }
    if (checkAdapter) {
      const doctor = spawnSync(process.execPath, [path.join(repositoryRoot, "tools", "agents", "pi-play.mjs"), "--doctor"], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
      if (doctor.status !== 0) throw new Error("model-free Pi Play adapter doctor failed");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
