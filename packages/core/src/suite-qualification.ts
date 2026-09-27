import { canonicalJson } from "./identity.js";
import {
  campaignCellExecutionSpecV2Hash, campaignPlanV2Hash, CampaignPlanV2Schema,
  type CampaignPlanV2,
} from "./campaign-v2.js";
import { assertPlayDecisionBudget, playSeedBundleHash, playTrajectoryHash } from "./play-metrics.js";
import { PLAY_DEFAULT_EPISODES, PLAY_VISUAL_PROTOCOL_V1 } from "./play-schema.js";
import { ReleaseLockV4Schema, type ReleaseLockV4 } from "./release-v4.js";
import { FlatSeriesResultV3Schema, type FlatSeriesResultV3 } from "./result-v3.js";
import type { JsonValue } from "./schema.js";

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(JSON.parse(JSON.stringify(left)) as JsonValue) === canonicalJson(JSON.parse(JSON.stringify(right)) as JsonValue);
}

export interface SuiteQualification {
  /** Complete full-suite coverage; a surviving game's mean cannot rank alone. */
  complete: boolean;
  tier: "official" | "experimental";
  reasons: string[];
}

/** Public-data invariants shared by CLI and site; raw evidence is checked separately. */
export function qualifyFlatSeriesV3(
  input: FlatSeriesResultV3,
  releaseInput: ReleaseLockV4,
  releaseFileHash: string,
  campaignInput?: CampaignPlanV2,
): SuiteQualification {
  const result = FlatSeriesResultV3Schema.parse(input);
  const release = ReleaseLockV4Schema.parse(releaseInput);
  if (result.benchmark_version !== release.benchmark_version || result.release_hash !== releaseFileHash) throw new Error("series is outside its exact release lock");
  let complete: boolean;
  if (result.suite === "build") {
    for (const reference of release.suites.build.tasks) {
      const task = result.tasks.find((candidate) => candidate.task_id === reference.id);
      if (!task || task.task_hash !== reference.hash || task.task_version !== reference.version || task.evaluation.seed !== release.suites.build.evaluation_seed) throw new Error(`mismatched Build release task: ${reference.id}`);
    }
    complete = result.build.completed === 4 && result.build.score !== undefined;
  } else {
    for (const game of result.games) {
      const reference = release.suites.play.tasks.find((task) => task.id === game.task_id);
      if (!reference || reference.hash !== game.game_hash || reference.version !== game.task_version || reference.game !== game.game || game.protocol !== PLAY_VISUAL_PROTOCOL_V1) throw new Error(`mismatched Play release task: ${game.task_id}`);
      assertPlayDecisionBudget(game.game, game.episodes);
      if (game.trajectory_hash !== playTrajectoryHash(game.task_id, game.episodes)) throw new Error(`${game.task_id}: game trajectory hash differs from episode vectors`);
    }
    complete = result.games.length === release.suites.play.tasks.length && result.games.every((game) =>
      game.coverage.completed === PLAY_DEFAULT_EPISODES && game.metrics !== undefined &&
      game.episodes.every((episode) => episode.status === "complete" && episode.trajectory_hash !== undefined),
    );
  }
  if (result.campaign) {
    if (!campaignInput) throw new Error("series has no available preregistered campaign plan");
    const plan = CampaignPlanV2Schema.parse(campaignInput);
    const binding = result.campaign;
    const cell = plan.cells.find((candidate) => candidate.cell_id === binding.cell_id);
    if (plan.campaign_id !== binding.id || plan.suite !== result.suite || plan.benchmark_version !== result.benchmark_version || plan.release_hash !== releaseFileHash ||
      binding.plan_hash !== campaignPlanV2Hash(plan) || !cell || cell.series_id !== result.series_id ||
      binding.execution_hash !== campaignCellExecutionSpecV2Hash(cell, plan.suite, plan.protocol)) throw new Error("series differs from its preregistered campaign cell");
    const expected = {
      agent: { id: cell.agent.id, version: cell.agent.version, model: cell.model, harness: cell.agent.id, parameters: { ...cell.parameters, provider: cell.provider } },
      prompt_language: cell.prompt_language,
    };
    if (!same(result.configuration, expected)) throw new Error("series configuration differs from its campaign cell");
    if (result.suite === "play") {
      if (plan.seed_commitment?.benchmark_version !== result.benchmark_version || !same(plan.seed_commitment.tasks, release.suites.play.tasks.map((task) => ({ task_id: task.id, episodes: task.episodes })))) throw new Error("campaign seed commitment does not cover the exact released Play suite");
    }
    if (result.suite === "play" && complete) {
      const bundle = {
        schema_version: 1 as const, benchmark_version: result.benchmark_version,
        tasks: result.games.map((game) => ({ task_id: game.task_id, seeds: game.episodes.map((episode) => episode.seed) })),
      };
      if (playSeedBundleHash(bundle) !== plan.seed_commitment?.seed_bundle_hash) throw new Error("episode seeds/order differ from the preregistered bundle");
    }
  } else if (campaignInput) throw new Error("campaign supplied for an unbound series");
  const reasons: string[] = [];
  if (!complete) reasons.push("incomplete full-suite coverage");
  if (result.profile !== "official") reasons.push("local experimental profile");
  if (!result.source_tree_clean || result.git_commit === "unknown") reasons.push("no clean recorded Git commit");
  if (!result.campaign) reasons.push("no preregistered campaign binding");
  return { complete, tier: reasons.length === 0 ? "official" : "experimental", reasons };
}
