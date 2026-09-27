import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPlayTask, playEpisodeTrajectoryHash, validatePlayTask, writeJson,
  type PlayEpisode, type PlayNativeAction,
} from "@carrick/gamebench-core";
import { episodeJsonName, runPlayEpisode, type EpisodePlayer } from "../src/play/episode.js";
import { freezePlayReference, playBytesHash, sealPlayEvidence, verifyPlayEvidence } from "../src/play/evidence.js";
import type { PlayObservation, PlayerSlotResult } from "../src/play/player.js";
import { replayPlayEpisode } from "../src/play/replay.js";

function actionSlot(action: PlayNativeAction, memo?: string): PlayerSlotResult {
  return {
    status: "action", action, ...(memo !== undefined ? { memo } : {}),
    response_text: JSON.stringify({ action, ...(memo !== undefined ? { memo } : {}) }),
    elapsed_ms: 1, attempts: [{ attempt: 0, status: "action", received_content: true, elapsed_ms: 1 }],
  };
}
function invalidSlot(): PlayerSlotResult {
  return { status: "invalid", response_text: "not JSON", elapsed_ms: 1,
    attempts: [{ attempt: 0, status: "invalid", received_content: true, elapsed_ms: 1 }] };
}
async function fixture(game: "2048" | "minesweeper" = "2048") {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-episode-"));
  const task = await freezePlayReference(await loadPlayTask(`play.${game}.v1`), path.join(root, "task"));
  return { root, task, episodeRoot: path.join(root, "task", "episodes", "000") };
}
function playerFactory(
  replies: (index: number) => PlayerSlotResult,
  observations: PlayObservation[],
): (root: string) => Promise<EpisodePlayer> {
  return async (root) => ({
    async observe(observation) {
      observations.push(structuredClone(observation));
      return replies(observations.length - 1);
    },
    async close() { await writeFile(path.join(root, "adapter.stderr.log"), "closed and flushed\n"); },
  });
}

for (const game of ["2048", "minesweeper"] as const) {
  test(`${game} episode seals bounded context and reproduces through both replay paths`, async () => {
    const f = await fixture(game);
    const observations: PlayObservation[] = [];
    try {
      const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"] as const;
      const recorded = await runPlayEpisode({
        ...f, episodeIndex: 0, seed: 42, promptLanguage: "en",
        createPlayer: playerFactory((index) => index < 12
          ? actionSlot(game === "2048" ? { type: "key", key: keys[index % 4]! }
            : { type: "click", button: "right", x: 435, y: 174 }, `memo-${index}`)
          : invalidSlot(), observations),
      });
      assert.equal(recorded.summary.status, "complete");
      assert.equal(recorded.summary.termination?.kind, "invalid-response-stop");
      assert.equal(recorded.summary.action_count, 15);
      assert.equal(observations[0]?.memo, "");
      assert.equal(observations[10]?.last_actions.length, 8);
      assert.equal(observations[14]?.memo, "memo-11");
      assert.ok(observations.every((observation) => !("seed" in observation) && !("board" in observation) && !("snapshot" in observation)));
      assert.equal(await verifyPlayEvidence(f.episodeRoot, recorded.seal_hash), recorded.seal_hash);
      assert.equal(await readFile(path.join(f.episodeRoot, "adapter.stderr.log"), "utf8"), "closed and flushed\n");
      const callsBefore = observations.length;
      for (const mode of ["engine", "browser"] as const) {
        const check = await replayPlayEpisode({ task: f.task, episodeRoot: f.episodeRoot, mode, expectedSeal: recorded.seal_hash });
        assert.equal(check.valid, true, check.errors.join("; "));
        assert.equal(check.score, recorded.summary.outcome?.score);
        assert.equal(check.won, recorded.summary.outcome?.won);
      }
      assert.equal(observations.length, callsBefore, "replay must never call a model/player");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("valid native no-ops consume all 200 decisions without an early episode clock", async () => {
  const f = await fixture();
  const observations: PlayObservation[] = [];
  try {
    const recorded = await runPlayEpisode({
      ...f, episodeIndex: 0, seed: 42, promptLanguage: "en",
      createPlayer: playerFactory(() => actionSlot({ type: "click", button: "left", x: 1, y: 1 }), observations),
    });
    assert.equal(observations.length, 200);
    assert.equal(observations.at(-1)?.remaining_decisions, 1);
    assert.equal(recorded.summary.termination?.kind, "decision-limit");
    assert.equal(recorded.summary.outcome?.score, 0);
    assert.ok(recorded.episode?.decisions.every((decision) => decision.status === "action" && decision.engine_commands.length === 0));
    const check = await replayPlayEpisode({ task: f.task, episodeRoot: f.episodeRoot });
    assert.equal(check.valid, true, check.errors.join("; "));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("timeout keeps earned score, while provider infrastructure failure has no outcome", async () => {
  for (const status of ["timeout", "infrastructure-failure"] as const) {
    const f = await fixture();
    const observations: PlayObservation[] = [];
    try {
      const recorded = await runPlayEpisode({
        ...f, episodeIndex: 0, seed: 42, promptLanguage: "en",
        createPlayer: playerFactory((index) => index < 8
          ? actionSlot({ type: "key", key: index % 2 ? "ArrowUp" : "ArrowLeft" })
          : { status, elapsed_ms: status === "timeout" ? 60_000 : 1,
              attempts: [{ attempt: 0, status: status === "timeout" ? "timeout" : "transport-error", received_content: false, elapsed_ms: status === "timeout" ? 60_000 : 1 }] }, observations),
      });
      assert.equal(observations.length, 9);
      if (status === "timeout") {
        assert.equal(recorded.summary.status, "complete");
        assert.equal(recorded.summary.termination?.kind, "slot-timeout");
        assert.ok(recorded.summary.outcome!.score > 0);
        const check = await replayPlayEpisode({ task: f.task, episodeRoot: f.episodeRoot });
        assert.equal(check.valid, true, check.errors.join("; "));
      } else {
        assert.equal(recorded.summary.status, "infrastructure-failure");
        assert.equal(recorded.summary.outcome, undefined);
        assert.equal((await replayPlayEpisode({ task: f.task, episodeRoot: f.episodeRoot })).valid, false);
      }
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("a broken renderer is an unscored failure before any player/model starts", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.task.root, "renderer.mjs"), "export function mountGame(){throw new Error('broken-renderer-mutant')}");
    const mutant = (await validatePlayTask(f.task.manifestPath)).task!;
    let starts = 0;
    const recorded = await runPlayEpisode({
      ...f, task: mutant, episodeIndex: 0, seed: 42, promptLanguage: "en",
      createPlayer: async () => { starts++; throw new Error("must not reach player"); },
    });
    assert.equal(starts, 0);
    assert.equal(recorded.summary.status, "infrastructure-failure");
    assert.equal(recorded.summary.outcome, undefined);
    assert.equal(recorded.episode, undefined, "unknown final observations must not be fabricated");
    await verifyPlayEvidence(f.episodeRoot, recorded.seal_hash);
    await assert.rejects(runPlayEpisode({ ...f, task: mutant, episodeIndex: 0, seed: 42, promptLanguage: "en", createPlayer: async () => { throw new Error("unused"); } }), /EEXIST/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a failed pending slot is counted without inventing its post-input state", async () => {
  const f = await fixture();
  try {
    const recorded = await runPlayEpisode({ ...f, episodeIndex: 0, seed: 42, promptLanguage: "en", createPlayer: async () => ({
      async observe() { throw new Error("unconfirmed request"); }, async close() {},
    }) });
    assert.equal(recorded.summary.status, "infrastructure-failure");
    assert.equal(recorded.summary.action_count, 1);
    assert.equal(recorded.episode, undefined);
    const failure = JSON.parse(await readFile(path.join(f.episodeRoot, "failure.json"), "utf8"));
    assert.deepEqual(failure.confirmed_decisions, []);
    assert.equal(recorded.summary.outcome, undefined);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("seed, termination, image and native-command mutants fail sealed/semantic replay", async () => {
  const f = await fixture();
  try {
    const original = await runPlayEpisode({
      ...f, episodeIndex: 0, seed: 42, promptLanguage: "en",
      createPlayer: playerFactory((index) => index < 3
        ? actionSlot({ type: "key", key: index % 2 ? "ArrowUp" : "ArrowLeft" }) : invalidSlot(), []),
    });
    assert.ok(original.episode);
    for (const mutant of ["seed", "termination", "image", "native"] as const) {
      const changed = path.join(f.root, `mutant-${mutant}`);
      await cp(f.episodeRoot, changed, { recursive: true });
      const episode = JSON.parse(await readFile(path.join(changed, "episode.json"), "utf8")) as PlayEpisode;
      if (mutant === "seed") episode.seed++;
      if (mutant === "termination") episode.termination = { kind: "decision-limit" };
      if (mutant === "image") {
        const replacement = await readFile(path.join(changed, "frames", "0001.png"));
        await writeFile(path.join(changed, "frames", "0000.png"), replacement);
        episode.decisions[0]!.frame_hash = playBytesHash(replacement);
        const file = path.join(changed, "observations", "0000.json");
        const observed = JSON.parse(await readFile(file, "utf8"));
        observed.frame_hash = playBytesHash(replacement);
        await writeJson(file, observed);
      }
      if (mutant === "native") {
        episode.decisions[0]!.native_action = { type: "key", key: "ArrowRight" };
        const file = path.join(changed, "answers", "0000.json");
        const answer = JSON.parse(await readFile(file, "utf8"));
        answer.action = episode.decisions[0]!.native_action;
        answer.response_text = JSON.stringify({ action: answer.action });
        await writeJson(file, answer);
        for (let index = 1; index < episode.decisions.length; index++) {
          const observationFile = path.join(changed, "observations", episodeJsonName(index));
          const observed = JSON.parse(await readFile(observationFile, "utf8"));
          observed.last_actions = episode.decisions.slice(Math.max(0, index - 8), index).map((decision) => ({
            status: decision.status, ...(decision.native_action ? { native_action: decision.native_action } : {}),
          }));
          await writeJson(observationFile, observed);
        }
      }
      episode.trajectory_hash = playEpisodeTrajectoryHash("2048", episode);
      await writeJson(path.join(changed, "episode.json"), episode);
      await rm(path.join(changed, "MANIFEST.sha256"));
      await sealPlayEvidence(changed);
      assert.equal((await replayPlayEpisode({ task: f.task, episodeRoot: changed, expectedSeal: original.seal_hash })).valid, false);
      const check = await replayPlayEpisode({ task: f.task, episodeRoot: changed, mode: mutant === "image" || mutant === "native" ? "browser" : "engine" });
      assert.equal(check.valid, false, `${mutant} must fail even after a local reseal`);
      assert.equal(check.score, undefined);
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("Play seals bind nested manifests and reject symlinks instead of silently skipping them", async () => {
  const f = await fixture();
  try {
    await runPlayEpisode({ ...f, episodeIndex: 0, seed: 42, promptLanguage: "en", createPlayer: playerFactory(() => invalidSlot(), []) });
    const hash = await sealPlayEvidence(path.join(f.root, "task"));
    await writeFile(path.join(f.episodeRoot, "MANIFEST.sha256"), "forged nested seal\n");
    await assert.rejects(verifyPlayEvidence(path.join(f.root, "task"), hash), /sealed manifest/);
    await symlink(path.join(f.task.root, "engine.mjs"), path.join(f.root, "task", "shadow.mjs"));
    await assert.rejects(verifyPlayEvidence(path.join(f.root, "task")), /symlink/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
