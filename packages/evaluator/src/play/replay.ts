import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PLAY_MEMO_MAX_BYTES, PLAY_SLOT_SECONDS, PLAY_VISUAL_PROTOCOL_V1,
  PlayEpisodeSchema, playEpisodeTrajectoryHash, sha256Canonical, validatePlayTask,
  type LoadedPlayTask, type PlayDecisionRecord,
} from "@carrick/gamebench-core";
import { PlayBrowser, PlayEngineClient } from "./engine-host.js";
import { parseEngineCommand, type EngineView } from "./engine-protocol.js";
import { episodeFrameName, episodeJsonName, terminationAfter, type PlayEpisodeMetadata } from "./episode.js";
import { playBytesHash, PlayEvidenceVerifier } from "./evidence.js";
import type { PlayerSlotResult } from "./player.js";
import { playEqual, validatePlayerSlot } from "./slot-audit.js";

export interface PlayReplayCheck {
  valid: boolean;
  mode: "engine" | "browser";
  decisions: number;
  errors: string[];
  evidence_hash?: string;
  score?: number;
  won?: boolean;
}

async function json(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")) as unknown; }

function assertPng(frame: Buffer): void {
  if (frame.length < 24 || !frame.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    frame.toString("ascii", 12, 16) !== "IHDR" || frame.readUInt32BE(16) !== 1280 || frame.readUInt32BE(20) !== 720) throw new Error("Play frame is not a 1280x720 PNG");
}

/** Recalculate from seed + actual commands/inputs; never load a recorded state. */
export async function replayPlayEpisode(options: {
  task: LoadedPlayTask;
  episodeRoot: string;
  mode?: "engine" | "browser";
  expectedSeal?: string;
  /** Share only within the current series check; never skips seal verification. */
  evidence?: PlayEvidenceVerifier;
}): Promise<PlayReplayCheck> {
  const mode = options.mode ?? "engine";
  const result: PlayReplayCheck = { valid: false, mode, decisions: 0, errors: [] };
  let engine: PlayEngineClient | undefined;
  let browser: PlayBrowser | undefined;
  try {
    result.evidence_hash = await (options.evidence ?? new PlayEvidenceVerifier()).verify(options.episodeRoot, options.expectedSeal);
    const task = options.task;
    const current = await validatePlayTask(task.manifestPath);
    if (!current.valid || current.task?.hash !== task.hash) throw new Error("reference game changed since its lock was read");
    const episode = PlayEpisodeSchema.parse(await json(path.join(options.episodeRoot, "episode.json")));
    if (episode.status !== "complete") throw new Error("infrastructure or partial episodes are not scored replays");
    if (episode.trajectory_hash !== playEpisodeTrajectoryHash(task.manifest.game, episode)) throw new Error("episode trajectory identity mismatch");
    const metadata = await json(path.join(options.episodeRoot, "metadata.json")) as PlayEpisodeMetadata;
    if (metadata.prompt_language !== "en" && metadata.prompt_language !== "zh") throw new Error("invalid Play prompt language");
    const rules = await readFile(path.join(task.root, task.manifest.prompt[metadata.prompt_language]), "utf8");
    const expectedMetadata: PlayEpisodeMetadata = {
      schema_version: 1, protocol: PLAY_VISUAL_PROTOCOL_V1, task_id: task.manifest.id,
      game: task.manifest.game, game_hash: task.hash, prompt_language: metadata.prompt_language,
      rules_hash: playBytesHash(rules), max_decisions: task.manifest.max_decisions,
      slot_seconds: PLAY_SLOT_SECONDS, memo_max_bytes: PLAY_MEMO_MAX_BYTES, history_length: 8,
      viewport: [1280, 720], device_scale_factor: 1,
    };
    if (!playEqual(metadata, expectedMetadata)) throw new Error("episode policy, rules or game binding differs from the fixed instrument");
    if (episode.action_count > metadata.max_decisions) throw new Error("episode exceeds its action budget");
    const turnIds = new Set(episode.decisions.map((decision) => decision.turn_id));
    if (turnIds.size !== episode.decisions.length) throw new Error("duplicate decision turn id");
    let view: EngineView;
    if (mode === "browser") {
      browser = await PlayBrowser.start({
        enginePath: path.join(task.root, task.manifest.engine), rendererPath: path.join(task.root, task.manifest.renderer),
        game: task.manifest.game, seed: episode.seed,
      });
      view = await browser.snapshot();
    } else {
      engine = new PlayEngineClient();
      view = await engine.init(path.join(task.root, task.manifest.engine), episode.seed);
    }
    if (sha256Canonical(view.snapshot) !== episode.initial_private_state_hash) throw new Error("initial private state does not match the seed");
    if (!playEqual(await json(path.join(options.episodeRoot, "states", episodeJsonName(0))), view.snapshot)) throw new Error("initial private snapshot differs from replay");
    let memo = "";
    const prefix: PlayDecisionRecord[] = [];
    for (const decision of episode.decisions) {
      const index = decision.dispatch_index;
      if (terminationAfter(prefix, view.outcome, metadata.max_decisions)) throw new Error("episode continued after its stopping condition");
      if (decision.turn_id !== `${task.manifest.id}:${episode.episode_index}:${index}`) throw new Error("non-canonical player turn identity");
      const frame = await readFile(path.join(options.episodeRoot, "frames", episodeFrameName(index)));
      assertPng(frame);
      if (playBytesHash(frame) !== decision.frame_hash) throw new Error(`input frame hash mismatch at decision ${index}`);
      if (browser && playBytesHash(await browser.frame()) !== decision.frame_hash) throw new Error(`native replay observation differs at decision ${index}`);
      const observed = await json(path.join(options.episodeRoot, "observations", episodeJsonName(index)));
      const expectedObservation = {
        turn_id: decision.turn_id, rules, frame_hash: decision.frame_hash,
        remaining_decisions: metadata.max_decisions - index,
        last_actions: prefix.slice(-8).map((previous) => ({
          status: previous.status === "action" ? "action" : "invalid",
          ...(previous.native_action ? { native_action: previous.native_action } : {}),
        })), memo,
      };
      if (!playEqual(observed, expectedObservation)) throw new Error(`unbounded or mismatched model context at decision ${index}`);
      const slot = await json(path.join(options.episodeRoot, "answers", episodeJsonName(index))) as PlayerSlotResult;
      validatePlayerSlot(slot, metadata.slot_seconds * 1000);
      if (slot.status !== decision.status || slot.elapsed_ms !== decision.elapsed_ms || slot.attempts.length !== decision.attempts ||
        !playEqual(slot.action, decision.native_action) || slot.memo !== decision.memo) throw new Error(`decision differs from player audit at ${index}`);
      if (decision.status === "action") {
        if (browser) {
          const applied = await browser.act(decision.native_action!);
          if (!playEqual(applied.commands, decision.engine_commands)) throw new Error(`native input/command divergence at decision ${index}`);
          view = applied.view;
        } else {
          for (const command of decision.engine_commands) view = await engine!.dispatch(parseEngineCommand(command, task.manifest.game));
          if (!decision.engine_commands.length) view = await engine!.observe();
        }
        if (decision.memo !== undefined) memo = decision.memo;
      } else view = browser ? await browser.snapshot() : await engine!.observe();
      if (sha256Canonical(view.snapshot) !== decision.private_state_hash) throw new Error(`private state divergence at decision ${index}`);
      if (!playEqual(await json(path.join(options.episodeRoot, "states", episodeJsonName(index + 1))), view.snapshot)) throw new Error(`stored private snapshot differs at decision ${index}`);
      prefix.push(decision);
      result.decisions++;
    }
    const expectedTermination = terminationAfter(prefix, view.outcome, metadata.max_decisions);
    if (!expectedTermination || !playEqual(episode.termination, expectedTermination)) throw new Error("episode termination differs from the actual stopping condition");
    if (!playEqual(view.outcome, episode.outcome)) throw new Error("recorded outcome differs from authoritative replay");
    if (sha256Canonical(view.snapshot) !== episode.final_private_state_hash) throw new Error("final state identity mismatch");
    const finalFrame = await readFile(path.join(options.episodeRoot, "frames", episodeFrameName(episode.action_count)));
    assertPng(finalFrame);
    if (playBytesHash(finalFrame) !== episode.final_frame_hash) throw new Error("final frame identity mismatch");
    if (browser && playBytesHash(await browser.frame()) !== episode.final_frame_hash) throw new Error("native replay final frame differs");
    result.score = view.outcome.score;
    result.won = view.outcome.won;
    result.valid = true;
  } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
  finally {
    try { await browser?.close(); await engine?.close(); }
    catch { result.valid = false; result.errors.push("replay cleanup failed"); }
  }
  if (!result.valid) { delete result.score; delete result.won; }
  return result;
}
