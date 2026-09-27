import { sha256Canonical } from "./identity.js";
import type { JsonValue } from "./schema.js";
import {
  PLAY_DEFAULT_EPISODES,
  PLAY_MAX_DECISIONS,
  PLAY_PRIMARY_ENDPOINTS,
  type PlayEpisode,
  type PlayEpisodeSummary,
  type PlayGame,
  type PlayGameMetrics,
  type PlayOutcome,
  type PlaySeedBundle,
  type PlaySeedCommitment,
} from "./play-schema.js";

/**
 * Pure arithmetic and identity helpers for Play. Every value here is
 * deterministic and re-computable from the recorded evidence, and never
 * averages a partial or infrastructure-failed episode into a metric.
 */

/** Rounds a value for display only; canonical metric values are never rounded. */
export function roundPlayMetric(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Strip `undefined` values so the result is a valid JSON value for hashing. */
function jsonProjection(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Bessel-corrected sample standard deviation (n-1), 0 when fewer than two. */
function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (values.length - 1),
  );
}

function winRate(wins: boolean[]): number {
  const won = wins.filter(Boolean).length;
  return (won / wins.length) * 100;
}

function requireOutcome(episode: PlayEpisodeSummary): PlayOutcome {
  if (episode.status !== "complete" || !episode.outcome) {
    throw new Error(
      `episode ${episode.episode_index} is not a complete scored episode`,
    );
  }
  return episode.outcome;
}

export interface PlayAggregation {
  complete: boolean;
  episodes: number;
  required: number;
  metrics?: PlayGameMetrics;
}

/**
 * Aggregate the per-game metric from a fixed series of episodes. Metrics are
 * withheld entirely unless every required episode completed with a native
 * outcome; an infrastructure-failure or partial episode is never averaged.
 */
export function aggregatePlayEpisodes(
  game: PlayGame,
  episodes: PlayEpisodeSummary[],
): PlayAggregation {
  const required = PLAY_DEFAULT_EPISODES;
  const complete =
    episodes.length === required &&
    episodes.every((episode) => episode.status === "complete");

  if (!complete) {
    return { complete: false, episodes: episodes.length, required };
  }

  if (game === "2048") {
    const outcomes = episodes.map(requireOutcome);
    const scores = outcomes.map((outcome) => outcome.score);
    const maxTiles = outcomes.map((outcome) => outcome.max_tile ?? 0);
    const effectiveMoves = outcomes.map(
      (outcome) => outcome.effective_moves ?? 0,
    );
    const metrics: PlayGameMetrics = {
      primary_metric: "mean_score",
      mean_score: mean(scores),
      episode_scores: scores,
      score_standard_deviation: sampleStandardDeviation(scores),
      max_tile: Math.max(...maxTiles),
      effective_moves: mean(effectiveMoves),
    };
    return {
      complete: true,
      episodes: episodes.length,
      required,
      metrics,
    };
  }

  const outcomes = episodes.map(requireOutcome);
  const wins = outcomes.map((outcome) => outcome.won);
  const coverage = outcomes.map((outcome) => {
    if (
      outcome.revealed_safe === undefined ||
      outcome.safe_cells === undefined ||
      outcome.safe_cells <= 0
    ) {
      return 0;
    }
    return (outcome.revealed_safe / outcome.safe_cells) * 100;
  });
  const actionCounts = episodes.map((episode) => episode.action_count);
  const metrics: PlayGameMetrics = {
    primary_metric: "win_rate",
    win_rate: winRate(wins),
    episode_wins: wins,
    safe_cell_coverage: mean(coverage),
    action_count: mean(actionCounts),
  };
  return {
    complete: true,
    episodes: episodes.length,
    required,
    metrics,
  };
}

/** The decision budget recorded for a game (2048: 200, Minesweeper: 128). */
export function playDecisionBudget(game: PlayGame): number {
  return PLAY_MAX_DECISIONS[game];
}

/** A display copy of metrics with every numeric field rounded to 4 decimals. */
export function roundPlayMetricsForDisplay(
  metrics: PlayGameMetrics,
): PlayGameMetrics {
  if (metrics.primary_metric === "mean_score") {
    return {
      primary_metric: "mean_score",
      mean_score: roundPlayMetric(metrics.mean_score),
      episode_scores: metrics.episode_scores.map((value) => roundPlayMetric(value)),
      score_standard_deviation: roundPlayMetric(metrics.score_standard_deviation),
      max_tile: metrics.max_tile,
      effective_moves: roundPlayMetric(metrics.effective_moves),
    };
  }
  return {
    primary_metric: "win_rate",
    win_rate: roundPlayMetric(metrics.win_rate),
    episode_wins: metrics.episode_wins,
    safe_cell_coverage: roundPlayMetric(metrics.safe_cell_coverage),
    action_count: roundPlayMetric(metrics.action_count),
  };
}

/** Reject any episode that spent more than the recorded decision budget. */
export function assertPlayDecisionBudget(
  game: PlayGame,
  episodes: PlayEpisodeSummary[],
): void {
  const budget = playDecisionBudget(game);
  for (const episode of episodes) {
    if (episode.action_count > budget) {
      throw new Error(
        `episode ${episode.episode_index} uses ${episode.action_count} decisions, exceeding the ${budget} budget for ${game}`,
      );
    }
  }
}

/** Reject duplicate episode_index or duplicate seed across a game's series. */
export function assertUniquePlayEpisodes(
  episodes: PlayEpisodeSummary[],
): void {
  const indices = new Set<number>();
  const seeds = new Set<number>();
  for (const episode of episodes) {
    if (indices.has(episode.episode_index)) {
      throw new Error(
        `duplicate episode_index ${episode.episode_index} in Play series`,
      );
    }
    indices.add(episode.episode_index);
    if (seeds.has(episode.seed)) {
      throw new Error(`duplicate seed ${episode.seed} in Play series`);
    }
    seeds.add(episode.seed);
  }
}

/** Assert a stored metric is the exact arithmetic projection of the episodes. */
export function assertPlayMetrics(
  game: PlayGame,
  episodes: PlayEpisodeSummary[],
  metrics: PlayGameMetrics,
): void {
  const expected = aggregatePlayEpisodes(game, episodes);
  if (!expected.complete || !expected.metrics) {
    throw new Error("cannot assert metrics for a non-complete Play series");
  }
  const actual = metrics;
  const expectedValue = expected.metrics;
  if (game === "2048") {
    if (
      actual.primary_metric !== "mean_score" ||
      expectedValue.primary_metric !== "mean_score"
    ) {
      throw new Error(
        `expected 2048 metrics to use mean_score, received ${(actual as { primary_metric: string }).primary_metric}`,
      );
    }
    const expectedScores = expectedValue.episode_scores;
    if (
      actual.episode_scores.length !== expectedScores.length ||
      actual.episode_scores.some((value, index) => value !== expectedScores[index])
    ) {
      throw new Error("2048 episode_scores do not match the recorded episodes");
    }
    if (
      actual.mean_score !== expectedValue.mean_score ||
      actual.score_standard_deviation !== expectedValue.score_standard_deviation ||
      actual.max_tile !== expectedValue.max_tile ||
      actual.effective_moves !== expectedValue.effective_moves
    ) {
      throw new Error("2048 metric arithmetic does not match the recorded episodes");
    }
    return;
  }
  if (
    actual.primary_metric !== "win_rate" ||
    expectedValue.primary_metric !== "win_rate"
  ) {
    throw new Error(
      `expected Minesweeper metrics to use win_rate, received ${(actual as { primary_metric: string }).primary_metric}`,
    );
  }
  if (
    actual.win_rate !== expectedValue.win_rate ||
    actual.safe_cell_coverage !== expectedValue.safe_cell_coverage ||
    actual.action_count !== expectedValue.action_count ||
    actual.episode_wins.length !== expectedValue.episode_wins.length ||
    actual.episode_wins.some((value, index) => value !== expectedValue.episode_wins[index])
  ) {
    throw new Error("Minesweeper metric arithmetic does not match the recorded episodes");
  }
}

/** The canonical per-episode trajectory hash from the sealed evidence. */
export function playEpisodeTrajectoryHash(
  game: PlayGame,
  episode: PlayEpisode,
): `sha256:${string}` {
  const projection = {
    game,
    episode_index: episode.episode_index,
    seed: episode.seed,
    status: episode.status,
    termination: episode.termination ?? null,
    initial_private_state_hash: episode.initial_private_state_hash,
    final_private_state_hash: episode.final_private_state_hash,
    final_frame_hash: episode.final_frame_hash,
    decisions: episode.decisions.map((decision) => ({
      turn_id: decision.turn_id,
      memo: decision.memo ?? null,
      dispatch_index: decision.dispatch_index,
      status: decision.status,
      ...(decision.native_action
        ? { native_action: decision.native_action }
        : {}),
      engine_commands: decision.engine_commands,
      private_state_hash: decision.private_state_hash,
      frame_hash: decision.frame_hash,
      elapsed_ms: decision.elapsed_ms,
      attempts: decision.attempts,
    })),
    outcome: episode.outcome ?? null,
  };
  return sha256Canonical(jsonProjection(projection));
}

/** The canonical game-level trajectory hash over a series of episode summaries. */
export function playTrajectoryHash(
  taskId: string,
  episodes: PlayEpisodeSummary[],
): `sha256:${string}` {
  const projection = {
    task_id: taskId,
    episodes: episodes.map((episode) => ({
      episode_index: episode.episode_index,
      seed: episode.seed,
      status: episode.status,
      termination: episode.termination ?? null,
      outcome: episode.outcome ?? null,
      action_count: episode.action_count,
      ...(episode.trajectory_hash
        ? { trajectory_hash: episode.trajectory_hash }
        : {}),
    })),
  };
  return sha256Canonical(jsonProjection(projection));
}

/**
 * Canonical SHA-256 of a Play seed bundle. This is the value a Campaign v2
 * commits before any measured call; the private bundle file is sealed later.
 */
export function playSeedBundleHash(
  bundle: PlaySeedBundle,
): `sha256:${string}` {
  return sha256Canonical(JSON.parse(JSON.stringify(bundle)) as JsonValue);
}

/** Assert a seed bundle reproduces its committed hash and task set. */
export function assertPlaySeedBundleCommitment(
  bundle: PlaySeedBundle,
  commitment: PlaySeedCommitment,
): void {
  const expectedHash = playSeedBundleHash(bundle);
  if (commitment.seed_bundle_hash !== expectedHash) {
    throw new Error(
      `seed bundle hash mismatch: expected ${expectedHash}, committed ${commitment.seed_bundle_hash}`,
    );
  }
  const bundleTasks = new Map(
    bundle.tasks.map((task) => [task.task_id, task.seeds]),
  );
  if (bundleTasks.size !== commitment.tasks.length) {
    throw new Error("seed bundle task set does not match the committed set");
  }
  for (const task of commitment.tasks) {
    const seeds = bundleTasks.get(task.task_id);
    if (!seeds) {
      throw new Error(`seed bundle is missing task ${task.task_id}`);
    }
    if (seeds.length !== task.episodes) {
      throw new Error(
        `seed bundle for ${task.task_id} has ${seeds.length} seeds; expected ${task.episodes}`,
      );
    }
  }
}

/** The preregistered endpoint for a game (used for suite-endpoint checks). */
export function playPrimaryEndpoint(game: PlayGame): string {
  return PLAY_PRIMARY_ENDPOINTS[game];
}
