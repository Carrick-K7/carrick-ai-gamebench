import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FlatSeriesResultPlayV3Schema, aggregatePlayEpisodes, createUlid, loadPlayTask,
  playTrajectoryHash, qualifyFlatSeriesV3, writeJson,
  type CampaignPlanV2, type FlatSeriesResultPlayV3, type PlaySeedBundle, type PlaySeriesTaskResult,
} from "@carrick/gamebench-core";
import { createSeriesRunDirectory } from "../lite-runner.js";
import { assertCampaignAtRecordedCommit, campaignV2ExecutionOptions, findCampaignCellV2 } from "../campaign-v2-io.js";
import { assertSuiteCatalog, gitState, loadSuiteRelease, requireOfficialSource } from "../suite-release.js";
import { assertSecretFreeSuiteConfiguration } from "../suite-configuration.js";
import { runPlayEpisode } from "./episode.js";
import { freezePlayReference, sealPlayEvidence } from "./evidence.js";
import { RpcPlayPlayer, type PlayPlayerIdentity } from "./player.js";
import { assertReleasedPlaySeeds, createPlaySeedCommitment, writePrivatePlaySeedBundle } from "./seeds.js";
import { playEqual } from "./slot-audit.js";

export interface PlaySeriesOptions {
  repositoryRoot: string;
  outputRoot: string;
  benchmarkVersion?: string;
  seriesId?: string;
  official: boolean;
  agentCommand: string;
  identity: PlayPlayerIdentity;
  configuration: FlatSeriesResultPlayV3["configuration"];
  seedBundle: PlaySeedBundle;
  campaign?: FlatSeriesResultPlayV3["campaign"];
  campaignPlan?: CampaignPlanV2;
}

/** Fixed, serial 2 × 10 measurement. No test deadline/episode-count overrides. */
export async function runPlaySeries(options: PlaySeriesOptions): Promise<{ runDir: string; result: FlatSeriesResultPlayV3 }> {
  assertSecretFreeSuiteConfiguration(options.configuration);
  const { release, releaseHash } = await loadSuiteRelease(options.repositoryRoot, options.benchmarkVersion);
  await assertSuiteCatalog(options.repositoryRoot, release);
  const seeds = assertReleasedPlaySeeds(options.seedBundle, release, options.campaignPlan?.seed_commitment);
  const declared = options.configuration.agent;
  if (declared.id !== options.identity.agent || declared.version !== options.identity.version || declared.model !== options.identity.model || declared.parameters.provider !== options.identity.provider || declared.parameters.thinking !== options.identity.thinking) throw new Error("player identity and declared configuration differ");
  if (options.official && (!options.campaign || !options.campaignPlan)) throw new Error("Official Play requires a preregistered campaign");
  const initialGit = options.official ? requireOfficialSource(options.repositoryRoot) : gitState(options.repositoryRoot);
  if (options.official) assertCampaignAtRecordedCommit(options.repositoryRoot, { git_commit: initialGit.commit }, options.campaignPlan!);
  const seriesId = options.seriesId ?? createUlid();
  const startedAt = new Date().toISOString();
  // Check even an empty provisional record's release/campaign configuration before any model call.
  const base = {
    schema_version: 3 as const, suite: "play" as const, benchmark_version: release.benchmark_version,
    release_hash: releaseHash, series_id: seriesId, git_commit: initialGit.commit,
    source_tree_clean: initialGit.clean, profile: options.official ? "official" as const : "local" as const,
    configuration: options.configuration, ...(options.campaign ? { campaign: options.campaign } : {}),
    started_at: startedAt, finished_at: startedAt,
  };
  const provisional = FlatSeriesResultPlayV3Schema.parse({ ...base, games: [] });
  qualifyFlatSeriesV3(provisional, release, releaseHash, options.campaignPlan);
  if (options.campaign && options.campaignPlan) {
    const expected = campaignV2ExecutionOptions(options.repositoryRoot, options.campaignPlan, findCampaignCellV2(options.campaignPlan, options.campaign.cell_id));
    if (expected.agentCommand !== options.agentCommand) throw new Error("actual player command differs from the preregistered adapter invocation");
  }
  const runDir = await createSeriesRunDirectory(options.outputRoot, seriesId);
  await chmod(runDir, 0o700);
  const marker = { schema_version: 2, benchmark_version: release.benchmark_version, series_id: seriesId, suite: "play", started_at: startedAt, ...(options.campaign ? { campaign_id: options.campaign.id, cell_id: options.campaign.cell_id, plan_hash: options.campaign.plan_hash } : {}) };
  const playerCwd = await mkdtemp(path.join(os.tmpdir(), "cagb-player-cwd-"));
  let finalized = false;
  try {
    await writeJson(path.join(runDir, ".series.json"), { ...marker, status: "prepared" });
    await writePrivatePlaySeedBundle(path.join(runDir, "seeds.private.json"), seeds);
    await writeJson(path.join(runDir, "seed-commitment.json"), createPlaySeedCommitment(seeds));
    await writeJson(path.join(runDir, "player.json"), { protocol: "play-visual-v1", identity: options.identity });
    await mkdir(path.join(runDir, "tasks"), { mode: 0o700 });
    // Freeze BOTH games before the first player starts, not one mutable source per episode.
    const tasks = [];
    for (const reference of release.suites.play.tasks) {
      const original = await loadPlayTask(reference.id, options.repositoryRoot);
      const taskRoot = path.join(runDir, "tasks", reference.id);
      const task = await freezePlayReference(original, taskRoot);
      if (task.hash !== reference.hash) throw new Error("frozen game differs from its release");
      tasks.push({ task, taskRoot });
    }
    await writeJson(path.join(runDir, ".series.json"), { ...marker, status: "running" });
    const games: PlaySeriesTaskResult[] = [];
    for (const { task, taskRoot } of tasks) {
      const bundle = seeds.tasks.find((item) => item.task_id === task.manifest.id)!;
      const episodes = [];
      for (const [episodeIndex, seed] of bundle.seeds.entries()) {
        const recorded = await runPlayEpisode({
          task, episodeRoot: path.join(taskRoot, "episodes", String(episodeIndex).padStart(3, "0")),
          episodeIndex, seed, promptLanguage: options.configuration.prompt_language,
          createPlayer: async (episodeRoot) => {
            const cwd = await mkdtemp(path.join(playerCwd, "episode-"));
            let active: RpcPlayPlayer | undefined;
            try {
              // The constructor's shorter test clock is deliberately never supplied here.
              const player = new RpcPlayPlayer({ command: options.agentCommand, cwd, stderrPath: path.join(episodeRoot, "adapter.stderr.log") });
              active = player;
              const identity = await player.init(task.manifest.game, options.identity);
              await writeJson(path.join(episodeRoot, "player.json"), { protocol: "play-visual-v1", identity });
              return {
                observe: player.observe.bind(player),
                async close() { try { await player.close(); } finally { await rm(cwd, { recursive: true, force: true }); } },
              };
            } catch (error) {
              try { await active?.close(); } finally { await rm(cwd, { recursive: true, force: true }); }
              throw error;
            }
          },
        });
        episodes.push(recorded.summary);
        // Never silently replace an infrastructure-failed seed/episode with a new attempt.
        if (recorded.summary.status !== "complete") break;
      }
      const aggregate = aggregatePlayEpisodes(task.manifest.game, episodes);
      games.push({
        task_id: task.manifest.id, task_version: task.manifest.version, game: task.manifest.game,
        game_hash: task.hash, protocol: "play-visual-v1", trajectory_hash: playTrajectoryHash(task.manifest.id, episodes),
        artifact_manifest_hash: await sealPlayEvidence(taskRoot), episodes,
        coverage: { completed: episodes.filter((episode) => episode.status === "complete").length, required: 10 },
        ...(aggregate.metrics ? { metrics: aggregate.metrics } : {}),
      });
      if (!aggregate.metrics) break;
    }
    await rm(playerCwd, { recursive: true, force: true });
    const finalGit = options.official ? requireOfficialSource(options.repositoryRoot, initialGit.commit) : gitState(options.repositoryRoot);
    const result = FlatSeriesResultPlayV3Schema.parse({
      ...base, source_tree_clean: initialGit.clean && finalGit.clean && initialGit.commit === finalGit.commit,
      finished_at: new Date().toISOString(), games,
    });
    const qualification = qualifyFlatSeriesV3(result, release, releaseHash, options.campaignPlan);
    const finalLock = await loadSuiteRelease(options.repositoryRoot, release.benchmark_version);
    if (finalLock.releaseHash !== releaseHash) throw new Error("release lock changed during measurement");
    await writeJson(path.join(runDir, "result.json"), result);
    await writeJson(path.join(runDir, ".series.json"), { ...marker, status: qualification.complete ? "complete" : "aborted", finished_at: result.finished_at });
    await sealPlayEvidence(runDir);
    finalized = true;
    return { runDir, result };
  } catch (error) {
    await writeJson(path.join(runDir, ".series.json"), { ...marker, status: "aborted", finished_at: new Date().toISOString() });
    await writeJson(path.join(runDir, "failure.json"), { kind: "infrastructure-failure", message: error instanceof Error ? error.message : String(error) });
    await sealPlayEvidence(runDir);
    finalized = true;
    throw error;
  } finally {
    await rm(playerCwd, { recursive: true, force: true });
    if (!finalized) await writeJson(path.join(runDir, ".series.json"), { ...marker, status: "aborted" });
  }
}

/** A checked root identity must agree with every per-episode player envelope. */
export async function assertPlayEpisodePlayer(episodeRoot: string, identity: PlayPlayerIdentity): Promise<void> {
  const recorded: unknown = JSON.parse(await readFile(path.join(episodeRoot, "player.json"), "utf8"));
  if (!playEqual(recorded, { protocol: "play-visual-v1", identity })) throw new Error("episode player identity differs from its series");
}
