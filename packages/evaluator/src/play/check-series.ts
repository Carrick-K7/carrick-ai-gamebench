import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  FlatSeriesResultPlayV3Schema, PlayDecisionRecordSchema, PlayEpisodeSchema, PlayEpisodeSummarySchema,
  qualifyFlatSeriesV3, validatePlayTask, type CampaignPlanV2,
} from "@carrick/gamebench-core";
import { loadSuiteRelease } from "../suite-release.js";
import { summarizePlayEpisode } from "./episode.js";
import { PlayEvidenceVerifier } from "./evidence.js";
import { replayPlayEpisode } from "./replay.js";
import { assertPlayEpisodePlayer } from "./series.js";
import { assertReleasedPlaySeeds, createPlaySeedCommitment, readPrivatePlaySeedBundle } from "./seeds.js";
import { playEqual } from "./slot-audit.js";
import type { PlayPlayerIdentity } from "./player.js";

async function exists(file: string) { try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function json(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")); }

export async function checkPlaySeries(options: {
  repositoryRoot: string; runDir: string; campaignPlan?: CampaignPlanV2;
  /** Publication always uses browser mode; engine mode is the explicitly cheaper diagnostic. */
  replayMode?: "engine" | "browser";
  requireComplete?: boolean;
}) {
  const { repositoryRoot, runDir } = options;
  const evidence = new PlayEvidenceVerifier();
  await evidence.verify(runDir);
  const result = FlatSeriesResultPlayV3Schema.parse(await json(path.join(runDir, "result.json")));
  if (path.basename(runDir) !== result.series_id || path.basename(path.dirname(runDir)) !== result.benchmark_version) throw new Error("run directory does not match its canonical version/series identity");
  const { release, releaseHash } = await loadSuiteRelease(repositoryRoot, result.benchmark_version);
  const qualification = qualifyFlatSeriesV3(result, release, releaseHash, options.campaignPlan);
  if (options.requireComplete && !qualification.complete) throw new Error("cannot publish an incomplete Play series");
  const seeds = assertReleasedPlaySeeds(await readPrivatePlaySeedBundle(path.join(runDir, "seeds.private.json")), release, options.campaignPlan?.seed_commitment);
  if (!playEqual(await json(path.join(runDir, "seed-commitment.json")), createPlaySeedCommitment(seeds))) throw new Error("recorded seed commitment differs from the sealed bundle");
  const agent = result.configuration.agent;
  if (typeof agent.parameters.provider !== "string" || typeof agent.parameters.thinking !== "string") throw new Error("Play configuration must name its actual provider and thinking mode");
  const identity: PlayPlayerIdentity = { agent: agent.id, version: agent.version, provider: agent.parameters.provider, model: agent.model, thinking: agent.parameters.thinking };
  await assertPlayEpisodePlayer(runDir, identity);
  const marker = await json(path.join(runDir, ".series.json")) as Record<string, unknown>;
  if (marker.schema_version !== 2 || marker.series_id !== result.series_id || marker.benchmark_version !== result.benchmark_version || marker.suite !== "play" || marker.started_at !== result.started_at || marker.finished_at !== result.finished_at || marker.status !== (qualification.complete ? "complete" : "aborted") || marker.campaign_id !== result.campaign?.id || marker.cell_id !== result.campaign?.cell_id || marker.plan_hash !== result.campaign?.plan_hash) throw new Error("series lifecycle marker differs from its result");
  for (const game of result.games) {
    const taskRoot = path.join(runDir, "tasks", game.task_id);
    await evidence.verify(taskRoot, game.artifact_manifest_hash);
    const checked = await validatePlayTask(path.join(taskRoot, "reference", "play", game.game, `v${game.task_version.split(".")[0]}`, "task.yml"));
    if (!checked.valid || !checked.task || checked.task.hash !== game.game_hash) throw new Error("frozen game differs from the recorded reference");
    const task = checked.task;
    const expectedSeeds = seeds.tasks.find((item) => item.task_id === task.manifest.id)!.seeds;
    const episodeEntries = await readdir(path.join(taskRoot, "episodes"));
    if (!playEqual(episodeEntries.sort(), game.episodes.map((episode) => String(episode.episode_index).padStart(3, "0")))) throw new Error("unlisted, repeated or missing episode directory");
    for (const summary of game.episodes) {
      if (summary.seed !== expectedSeeds[summary.episode_index]) throw new Error("episode seed differs from the committed ordered bundle");
      const episodeRoot = path.join(taskRoot, "episodes", String(summary.episode_index).padStart(3, "0"));
      await evidence.verify(episodeRoot);
      const fullFile = path.join(episodeRoot, "episode.json");
      if (await exists(fullFile)) {
        const episode = PlayEpisodeSchema.parse(await json(fullFile));
        if (!playEqual(summary, summarizePlayEpisode(episode))) throw new Error("episode summary differs from sealed raw trajectory");
        if (summary.action_count > 0) await assertPlayEpisodePlayer(episodeRoot, identity);
        if (summary.status === "complete") {
          const replay = await replayPlayEpisode({ task, episodeRoot, mode: options.replayMode ?? "browser", evidence });
          if (!replay.valid) throw new Error(`${game.task_id}/${summary.episode_index}: ${replay.errors.join("; ")}`);
        }
      } else {
        const failure = await json(path.join(episodeRoot, "failure.json")) as Record<string, unknown>;
        const { confirmed_decisions, started_at: _start, finished_at: _finish, ...projection } = failure;
        const parsed = PlayEpisodeSummarySchema.parse(projection);
        if (parsed.status !== "infrastructure-failure" || !playEqual(parsed, summary)) throw new Error("unconfirmed episode summary differs from raw failure");
        const prefix = PlayDecisionRecordSchema.array().parse(confirmed_decisions);
        if (prefix.length > summary.action_count || summary.action_count - prefix.length > 1 || prefix.some((decision, index) => decision.dispatch_index !== index)) throw new Error("invalid confirmed prefix in failed episode");
        if (summary.action_count > 0) await assertPlayEpisodePlayer(episodeRoot, identity);
      }
    }
  }
  return { result, qualification };
}
