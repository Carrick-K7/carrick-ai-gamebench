import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PLAY_INVALID_RESPONSE_STOP, PLAY_MEMO_MAX_BYTES, PLAY_SLOT_SECONDS, PLAY_VISUAL_PROTOCOL_V1,
  PlayDecisionRecordSchema, PlayEpisodeSchema, PlayEpisodeSummarySchema, PlaySeedSchema,
  playEpisodeTrajectoryHash, sha256Canonical, validatePlayTask, writeJson,
  type LoadedPlayTask, type PlayDecisionRecord, type PlayEpisode, type PlayEpisodeSummary,
  type PlayOutcome, type PlayTermination,
} from "@carrick/gamebench-core";
import { PlayBrowser } from "./engine-host.js";
import type { EngineView } from "./engine-protocol.js";
import { playBytesHash, sealPlayEvidence } from "./evidence.js";
import type { PlayObservation, PlayerSlotResult } from "./player.js";
import { validatePlayerSlot } from "./slot-audit.js";

export interface EpisodePlayer {
  observe(observation: PlayObservation): Promise<PlayerSlotResult>;
  close(): Promise<void>;
}

export interface PlayEpisodeMetadata {
  schema_version: 1;
  protocol: typeof PLAY_VISUAL_PROTOCOL_V1;
  task_id: string;
  game: "2048" | "minesweeper";
  game_hash: string;
  prompt_language: "en" | "zh";
  rules_hash: string;
  max_decisions: number;
  slot_seconds: number;
  memo_max_bytes: number;
  history_length: number;
  viewport: [1280, 720];
  device_scale_factor: 1;
}

export function episodeFrameName(index: number): string { return `${String(index).padStart(4, "0")}.png`; }
export function episodeJsonName(index: number): string { return `${String(index).padStart(4, "0")}.json`; }

export function terminationAfter(
  decisions: PlayDecisionRecord[], outcome: PlayOutcome, budget: number,
): PlayTermination | undefined {
  const last = decisions.at(-1);
  if (last?.status === "infrastructure-failure") return { kind: "infrastructure-failure", reason: "player-infrastructure-failure" };
  if (outcome.terminal) return { kind: "game-over" };
  if (last?.status === "timeout") return { kind: "slot-timeout" };
  let invalid = 0;
  for (let index = decisions.length - 1; index >= 0 && decisions[index]?.status === "invalid"; index--) invalid++;
  if (invalid >= PLAY_INVALID_RESPONSE_STOP) return { kind: "invalid-response-stop", consecutive_invalid: invalid };
  if (decisions.length === budget) return { kind: "decision-limit" };
  return undefined;
}

export function summarizePlayEpisode(episode: PlayEpisode): PlayEpisodeSummary {
  return PlayEpisodeSummarySchema.parse({
    episode_index: episode.episode_index, seed: episode.seed, status: episode.status,
    action_count: episode.action_count,
    ...(episode.termination ? { termination: episode.termination } : {}),
    ...(episode.outcome ? { outcome: episode.outcome } : {}),
    ...(episode.trajectory_hash ? { trajectory_hash: episode.trajectory_hash } : {}),
  });
}

/** One fresh episode. No shortened episode clock and no reuse of an existing directory. */
export async function runPlayEpisode(options: {
  task: LoadedPlayTask;
  episodeRoot: string;
  episodeIndex: number;
  seed: number;
  promptLanguage: "en" | "zh";
  createPlayer: (episodeRoot: string) => Promise<EpisodePlayer>;
}): Promise<{ summary: PlayEpisodeSummary; episode?: PlayEpisode; seal_hash: string }> {
  const { task, episodeRoot } = options;
  PlaySeedSchema.parse(options.seed);
  const frozen = await validatePlayTask(task.manifestPath);
  if (!frozen.valid || frozen.task?.hash !== task.hash) throw new Error("reference package changed before the episode started");
  if (!Number.isInteger(options.episodeIndex) || options.episodeIndex < 0 || options.episodeIndex >= task.manifest.episodes) throw new Error("episode index is outside the fixed series");
  await mkdir(path.dirname(episodeRoot), { recursive: true, mode: 0o700 });
  await mkdir(episodeRoot, { mode: 0o700 });
  for (const directory of ["frames", "states", "observations", "answers"]) await mkdir(path.join(episodeRoot, directory), { mode: 0o700 });
  const rules = await readFile(path.join(task.root, task.manifest.prompt[options.promptLanguage]), "utf8");
  const metadata: PlayEpisodeMetadata = {
    schema_version: 1, protocol: PLAY_VISUAL_PROTOCOL_V1, task_id: task.manifest.id,
    game: task.manifest.game, game_hash: task.hash, prompt_language: options.promptLanguage,
    rules_hash: playBytesHash(rules), max_decisions: task.manifest.max_decisions,
    slot_seconds: PLAY_SLOT_SECONDS, memo_max_bytes: PLAY_MEMO_MAX_BYTES, history_length: 8,
    viewport: [1280, 720], device_scale_factor: 1,
  };
  await writeJson(path.join(episodeRoot, "metadata.json"), metadata);
  const startedAt = new Date().toISOString();
  const decisions: PlayDecisionRecord[] = [];
  let consumedSlots = 0;
  let browser: PlayBrowser | undefined;
  let player: EpisodePlayer | undefined;
  let initial: EngineView | undefined;
  let view: EngineView | undefined;
  let frame: Buffer | undefined;
  let memo = "";
  let termination: PlayTermination | undefined;
  let failure = false;
  try {
    browser = await PlayBrowser.start({
      enginePath: path.join(task.root, task.manifest.engine),
      rendererPath: path.join(task.root, task.manifest.renderer),
      game: task.manifest.game, seed: options.seed,
    });
    initial = view = await browser.snapshot();
    frame = await browser.frame();
    await writeJson(path.join(episodeRoot, "states", episodeJsonName(0)), view.snapshot);
    await writeFile(path.join(episodeRoot, "frames", episodeFrameName(0)), frame);
    player = await options.createPlayer(episodeRoot);
    while (!termination && decisions.length < metadata.max_decisions) {
      const index = decisions.length;
      const observation: PlayObservation = {
        turn_id: `${task.manifest.id}:${options.episodeIndex}:${index}`,
        rules, frame: { media_type: "image/png", data: frame.toString("base64") },
        remaining_decisions: metadata.max_decisions - index,
        last_actions: decisions.slice(-8).map((decision) => ({
          status: decision.status === "action" ? "action" as const : "invalid" as const,
          ...(decision.native_action ? { native_action: decision.native_action } : {}),
        })), memo,
      };
      const frameHash = playBytesHash(frame);
      await writeJson(path.join(episodeRoot, "observations", episodeJsonName(index)), {
        turn_id: observation.turn_id, rules, frame_hash: frameHash,
        remaining_decisions: observation.remaining_decisions, last_actions: observation.last_actions, memo,
      });
      consumedSlots++;
      const slot = await player.observe(observation);
      await writeJson(path.join(episodeRoot, "answers", episodeJsonName(index)), slot);
      validatePlayerSlot(slot, metadata.slot_seconds * 1000);
      let commands: PlayDecisionRecord["engine_commands"] = [];
      if (slot.status === "action") {
        const applied = await browser.act(slot.action!);
        commands = applied.commands;
        view = applied.view;
        if (slot.memo !== undefined) memo = slot.memo;
      } else view = await browser.snapshot();
      frame = await browser.frame();
      // Only confirmed post-input observations become decision records. If the
      // browser dies mid-input, the attempted action stays in answers/, not a
      // fabricated command/state in the canonical trajectory.
      const decision = PlayDecisionRecordSchema.parse({
        turn_id: observation.turn_id, dispatch_index: index, status: slot.status,
        ...(slot.action ? { native_action: slot.action } : {}), engine_commands: commands,
        frame_hash: frameHash, private_state_hash: sha256Canonical(view.snapshot),
        elapsed_ms: slot.elapsed_ms, attempts: slot.attempts.length,
        ...(slot.memo !== undefined ? { memo: slot.memo } : {}),
      });
      await writeJson(path.join(episodeRoot, "states", episodeJsonName(index + 1)), view.snapshot);
      await writeFile(path.join(episodeRoot, "frames", episodeFrameName(index + 1)), frame);
      decisions.push(decision);
      termination = terminationAfter(decisions, view.outcome, metadata.max_decisions);
    }
  } catch {
    failure = true;
    termination = { kind: "infrastructure-failure", reason: "reference-or-adapter-runtime-failure" };
  } finally {
    try { await player?.close(); } catch { failure = true; }
    try { await browser?.close(); } catch { failure = true; }
    try {
      const checked = await validatePlayTask(task.manifestPath);
      if (!checked.valid || checked.task?.hash !== task.hash) failure = true;
    } catch { failure = true; }
  }
  if (failure) {
    // Do not claim a final state/PNG when its observation or log closure failed.
    const summary = PlayEpisodeSummarySchema.parse({
      episode_index: options.episodeIndex, seed: options.seed, status: "infrastructure-failure",
      termination: { kind: "infrastructure-failure", reason: "reference-or-adapter-runtime-failure" },
      action_count: consumedSlots,
    });
    await writeJson(path.join(episodeRoot, "failure.json"), { ...summary, confirmed_decisions: decisions, started_at: startedAt, finished_at: new Date().toISOString() });
    return { summary, seal_hash: await sealPlayEvidence(episodeRoot) };
  }
  if (!initial || !view || !frame || !termination) throw new Error("episode completed without authoritative observations");
  const episode = PlayEpisodeSchema.parse({
    episode_index: options.episodeIndex, seed: options.seed,
    status: termination.kind === "infrastructure-failure" ? "infrastructure-failure" : "complete",
    termination, ...(termination.kind === "infrastructure-failure" ? {} : { outcome: view.outcome }),
    action_count: decisions.length, decisions,
    initial_private_state_hash: sha256Canonical(initial.snapshot),
    final_private_state_hash: sha256Canonical(view.snapshot), final_frame_hash: playBytesHash(frame),
    started_at: startedAt, finished_at: new Date().toISOString(),
  });
  episode.trajectory_hash = playEpisodeTrajectoryHash(task.manifest.game, episode);
  await writeJson(path.join(episodeRoot, "episode.json"), episode);
  return { episode, summary: summarizePlayEpisode(episode), seal_hash: await sealPlayEvidence(episodeRoot) };
}
