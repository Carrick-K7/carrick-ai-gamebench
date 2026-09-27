import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  PLAY_MAX_DECISIONS,
  PLAY_PRIMARY_METRIC,
  PlayEngineCommandSchema,
  PlayDecisionRecordSchema,
  PlayEpisodeSchema,
  PlayEpisodeSummarySchema,
  PlayNativeActionSchema,
  PlayOutcomeSchema,
  PlaySeedBundleSchema,
  PlayTaskManifestSchema,
  aggregatePlayEpisodes,
  assertPlayMetrics,
  assertPlaySeedBundleCommitment,
  playSeedBundleHash,
  playTrajectoryHash,
  roundPlayMetric,
  roundPlayMetricsForDisplay,
  type PlayEpisodeSummary,
  type PlayMeanScoreMetrics,
  type PlayOutcome,
  type PlaySeedBundle,
} from "../src/index.js";

const hash = (input: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(input).digest("hex")}`;

const validManifest = {
  schema_version: 1,
  id: "play.2048.v1",
  version: "1.0.0",
  title: { en: "2048", zh: "2048" },
  suite: "play",
  game: "2048",
  engine: "engine.mjs",
  renderer: "renderer.mjs",
  prompt: { en: "prompt.en.md", zh: "prompt.zh.md" },
  episodes: 10,
  max_decisions: 200,
  viewport: [1280, 720],
  device_scale_factor: 1,
  primary_metric: "mean_score",
  license: "Apache-2.0",
};

const outcome = (overrides: Partial<PlayOutcome> = {}): PlayOutcome => ({
  terminal: true,
  won: true,
  score: 100,
  max_tile: 2048,
  effective_moves: 50,
  ...overrides,
});

function summary(
  index: number,
  seed: number,
  status: "complete" | "infrastructure-failure" | "partial" = "complete",
): PlayEpisodeSummary {
  const base = { episode_index: index, seed, status, action_count: 10 };
  if (status === "complete") {
    return {
      ...base,
      termination: { kind: "game-over" },
      outcome: outcome(),
    };
  }
  if (status === "infrastructure-failure") {
    return {
      ...base,
      termination: { kind: "infrastructure-failure", reason: "browser crash" },
    };
  }
  return base;
}

test("play coordination manifests accept both canonical games", () => {
  assert.equal(PlayTaskManifestSchema.safeParse(validManifest).success, true);
  const minesweeper = {
    ...validManifest,
    id: "play.minesweeper.v1",
    game: "minesweeper",
    max_decisions: 128,
    primary_metric: "win_rate",
  };
  assert.equal(PlayTaskManifestSchema.safeParse(minesweeper).success, true);
});

test("play manifests constrain game identity, budget and primary metric", () => {
  assert.equal(
    PlayTaskManifestSchema.safeParse({
      ...validManifest,
      game: "minesweeper",
    }).success,
    false,
  );
  assert.equal(
    PlayTaskManifestSchema.safeParse({
      ...validManifest,
      max_decisions: 128,
    }).success,
    false,
  );
  assert.equal(
    PlayTaskManifestSchema.safeParse({
      ...validManifest,
      primary_metric: "win_rate",
    }).success,
    false,
  );
  assert.equal(
    PlayTaskManifestSchema.safeParse({
      ...validManifest,
      id: "play.other.v1",
    }).success,
    false,
  );
  assert.equal(
    PlayTaskManifestSchema.safeParse({
      ...validManifest,
      version: "2.0.0",
    }).success,
    false,
  );
});

test("play manifests forbid non-canonical paths, viewport, engine and license", () => {
  for (const overrides of [
    { engine: "src/engine.mjs" },
    { renderer: "renderer.js" },
    { prompt: { en: "prompt.md", zh: "prompt.zh.md" } },
    { viewport: [1920, 720] },
    { device_scale_factor: 2 },
    { license: "MIT" },
    { episodes: 5 },
  ]) {
    assert.equal(
      PlayTaskManifestSchema.safeParse({ ...validManifest, ...overrides }).success,
      false,
      JSON.stringify(overrides),
    );
  }
});

test("native actions and engine commands are gated to the official surface", () => {
  assert.equal(
    PlayNativeActionSchema.safeParse({ type: "key", key: "ArrowLeft" }).success,
    true,
  );
  assert.equal(
    PlayNativeActionSchema.safeParse({ type: "click", button: "right", x: 640, y: 360 }).success,
    true,
  );
  assert.equal(
    PlayNativeActionSchema.safeParse({ type: "key", key: "Space" }).success,
    false,
  );
  assert.equal(
    PlayNativeActionSchema.safeParse({ type: "click", button: "left", x: 2000, y: 360 }).success,
    false,
  );
  assert.equal(
    PlayNativeActionSchema.safeParse({ type: "eval", code: "alert(1)" }).success,
    false,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "move", direction: "up" }).success,
    true,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "reveal", row: 3, col: 7 }).success,
    true,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "flag", row: 1, col: 2 }).success,
    true,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "reveal", row: 9, col: 9 }).success,
    true,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "reveal", row: 10, col: 0 }).success,
    false,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "flag", row: 0, col: 10 }).success,
    false,
  );
  assert.equal(
    PlayEngineCommandSchema.safeParse({ type: "jump" }).success,
    false,
  );
});

test("outcomes require terminal wins and consistent safe-cell coverage", () => {
  assert.equal(PlayOutcomeSchema.safeParse(outcome()).success, true);
  assert.equal(
    PlayOutcomeSchema.safeParse(outcome({ won: true, terminal: false })).success,
    false,
  );
  assert.equal(
    PlayOutcomeSchema.safeParse(outcome({ safe_cells: 10, revealed_safe: 11 })).success,
    false,
  );
  assert.equal(
    PlayOutcomeSchema.safeParse(outcome({ terminal: false, won: false, score: 0 })).success,
    true,
  );
});

test("episode summaries distinguish complete, infrastructure and partial states", () => {
  assert.equal(PlayEpisodeSummarySchema.safeParse(summary(0, 1)).success, true);
  assert.equal(
    PlayEpisodeSummarySchema.safeParse(summary(0, 1, "infrastructure-failure")).success,
    true,
  );
  assert.equal(
    PlayEpisodeSummarySchema.safeParse(summary(0, 1, "partial")).success,
    true,
  );
  // A "complete" episode without an outcome is rejected.
  assert.equal(
    PlayEpisodeSummarySchema.safeParse({
      episode_index: 0,
      seed: 1,
      status: "complete",
      action_count: 10,
      termination: { kind: "game-over" },
    }).success,
    false,
  );
  // A "complete" episode may never terminate as infrastructure-failure.
  assert.equal(
    PlayEpisodeSummarySchema.safeParse({
      ...summary(0, 1),
      termination: { kind: "infrastructure-failure", reason: "x" },
    }).success,
    false,
  );
  // A partial episode may not carry an outcome.
  assert.equal(
    PlayEpisodeSummarySchema.safeParse({
      ...summary(0, 1, "partial"),
      outcome: outcome(),
    }).success,
    false,
  );
});

test("sealed episode evidence sequences decisions and bounds the memo", () => {
  const episode = {
    ...summary(0, 1),
    action_count: 1,
    initial_private_state_hash: hash("0"),
    final_private_state_hash: hash("f"),
    final_frame_hash: hash("ff"),
    started_at: "2026-09-06T00:00:00.000Z",
    finished_at: "2026-09-06T00:00:30.000Z",
    decisions: [
      {
        turn_id: "t1",
        dispatch_index: 0,
        status: "action",
        native_action: { type: "key", key: "ArrowUp" },
        engine_commands: [{ type: "move", direction: "up" }],
        frame_hash: hash("a"),
        private_state_hash: hash("b"),
        elapsed_ms: 100,
        attempts: 1,
      },
    ],
  };
  assert.equal(PlayEpisodeSchema.safeParse(episode).success, true);
  assert.equal(
    PlayEpisodeSchema.safeParse({
      ...episode,
      decisions: [{ ...episode.decisions[0]!, dispatch_index: 3 }],
    }).success,
    false,
  );
  assert.equal(
    PlayEpisodeSchema.safeParse({
      ...episode,
      decisions: [{ ...episode.decisions[0]!, memo: "x".repeat(2048) }],
    }).success,
    false,
  );
});

test("decision records record invalid/no-op slots without fabricating actions", () => {
  const base = {
    turn_id: "t1",
    dispatch_index: 0,
    frame_hash: hash("a"),
    private_state_hash: hash("b"),
    elapsed_ms: 100,
    attempts: 1,
  };
  // A valid no-op action (click inside the viewport but off the board) keeps
  // its native_action and an empty engine_commands array.
  const noOp = {
    ...base,
    status: "action",
    native_action: { type: "click", button: "left", x: 640, y: 360 },
    engine_commands: [],
  };
  assert.equal(PlayDecisionRecordSchema.safeParse(noOp).success, true);
  // An invalid response never carries a fabricated native_action or command.
  const invalidRecord = {
    ...base,
    status: "invalid",
    engine_commands: [],
  };
  assert.equal(PlayDecisionRecordSchema.safeParse(invalidRecord).success, true);
  assert.equal(
    PlayDecisionRecordSchema.safeParse({
      ...invalidRecord,
      native_action: { type: "key", key: "ArrowUp" },
    }).success,
    false,
  );
  assert.equal(
    PlayDecisionRecordSchema.safeParse({
      ...invalidRecord,
      engine_commands: [{ type: "move", direction: "up" }],
    }).success,
    false,
  );
  // A timeout slot is a non-action slot with an empty command list.
  assert.equal(
    PlayDecisionRecordSchema.safeParse({
      ...base,
      status: "timeout",
      engine_commands: [],
    }).success,
    true,
  );
  // An action slot must carry its native_action.
  assert.equal(
    PlayDecisionRecordSchema.safeParse({
      ...base,
      status: "action",
      engine_commands: [],
    }).success,
    false,
  );
});

test("2048 aggregation reports mean_score and sample standard deviation", () => {
  const episodes = Array.from({ length: 10 }, (_, index) =>
    summary(index, index + 1),
  );
  const aggregate = aggregatePlayEpisodes("2048", episodes);
  assert.equal(aggregate.complete, true);
  assert.ok(aggregate.metrics);
  if (aggregate.metrics) {
    assert.equal(aggregate.metrics.primary_metric, "mean_score");
    assert.equal(aggregate.metrics.mean_score, 100);
    assert.equal(aggregate.metrics.score_standard_deviation, 0);
    assert.equal(aggregate.metrics.max_tile, 2048);
    assert.equal(aggregate.metrics.episode_scores.length, 10);
  }
});

test("Minesweeper aggregation reports win_rate and coverage percentages", () => {
  const episodes = Array.from({ length: 10 }, (_, index) =>
    summary(index, index + 100, "complete"),
  ).map((episode, index) => ({
    ...episode,
    outcome: outcome({
      terminal: true,
      won: index < 6,
      score: 0,
      revealed_safe: index < 6 ? 90 : 45,
      safe_cells: 90,
    }),
  }));
  const aggregate = aggregatePlayEpisodes("minesweeper", episodes);
  assert.equal(aggregate.complete, true);
  assert.ok(aggregate.metrics);
  if (aggregate.metrics) {
    assert.equal(aggregate.metrics.primary_metric, "win_rate");
    assert.equal(aggregate.metrics.win_rate, 60);
    assert.equal(aggregate.metrics.safe_cell_coverage, 80);
    assert.equal(aggregate.metrics.episode_wins.filter(Boolean).length, 6);
  }
});

test("an incomplete or infrastructure-failed series withholds all metrics", () => {
  const episodes = Array.from({ length: 9 }, (_, index) =>
    summary(index, index + 1),
  );
  const incomplete = aggregatePlayEpisodes("2048", episodes);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.metrics, undefined);

  const infra = Array.from({ length: 10 }, (_, index) =>
    summary(index, index + 1),
  ).map((episode, index) =>
    index === 5
      ? summary(index, index + 1, "infrastructure-failure")
      : episode,
  );
  const withInfra = aggregatePlayEpisodes("2048", infra);
  assert.equal(withInfra.complete, false);
  assert.equal(withInfra.metrics, undefined);
});

test("play metrics arithmetic is asserted exactly against the episodes", () => {
  const episodes = Array.from({ length: 10 }, (_, index) =>
    summary(index, index + 1),
  );
  const aggregate = aggregatePlayEpisodes("2048", episodes);
  assert.ok(aggregate.metrics);
  assert.doesNotThrow(() =>
    assertPlayMetrics("2048", episodes, aggregate.metrics!),
  );
  const meanMetrics = aggregate.metrics as PlayMeanScoreMetrics;
  assert.throws(
    () =>
      assertPlayMetrics("2048", episodes, {
        primary_metric: "mean_score",
        mean_score: 1,
        episode_scores: meanMetrics.episode_scores,
        score_standard_deviation: meanMetrics.score_standard_deviation,
        max_tile: 1,
        effective_moves: 1,
      }),
    /2048 metric arithmetic/,
  );
});

test("seed bundles enforce distinct seeds per committed task", () => {
  const bundle = {
    schema_version: 1,
    benchmark_version: "0.7.0",
    tasks: [
      { task_id: "play.2048.v1", seeds: Array.from({ length: 10 }, (_, index) => index) },
      { task_id: "play.minesweeper.v1", seeds: Array.from({ length: 10 }, (_, index) => 100 + index) },
    ],
  } satisfies PlaySeedBundle;
  assert.equal(PlaySeedBundleSchema.safeParse(bundle).success, true);
  assert.equal(
    PlaySeedBundleSchema.safeParse({
      ...bundle,
      tasks: [
        { task_id: "play.2048.v1", seeds: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      ],
    }).success,
    false,
  );
  assert.equal(
    PlaySeedBundleSchema.safeParse({
      ...bundle,
      tasks: [{ task_id: "play.2048.v1", seeds: [1, 2, 3] }],
    }).success,
    false,
  );
});

test("the trajectory hash and seed-bundle commitment are stable and verifiable", () => {
  const episodes = Array.from({ length: 10 }, (_, index) =>
    summary(index, index + 1),
  );
  assert.equal(
    playTrajectoryHash("play.2048.v1", episodes),
    playTrajectoryHash("play.2048.v1", episodes),
  );
  const bundle = {
    schema_version: 1,
    benchmark_version: "0.7.0",
    tasks: [
      { task_id: "play.2048.v1", seeds: Array.from({ length: 10 }, (_, index) => index) },
    ],
  } satisfies PlaySeedBundle;
  const committed = playSeedBundleHash(bundle);
  assert.match(committed, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotThrow(() =>
    assertPlaySeedBundleCommitment(bundle, {
      schema_version: 1,
      benchmark_version: "0.7.0",
      seed_bundle_hash: committed,
      tasks: [{ task_id: "play.2048.v1", episodes: 10 }],
    }),
  );
  assert.throws(
    () =>
      assertPlaySeedBundleCommitment(bundle, {
        schema_version: 1,
        benchmark_version: "0.7.0",
        seed_bundle_hash: hash("z"),
        tasks: [{ task_id: "play.2048.v1", episodes: 10 }],
      }),
    /seed bundle hash mismatch/,
  );
});

test("canonical metric values stay unrounded; rounding is display-only", () => {
  const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const episodes = scores.map((score, index) => ({
    ...summary(index, index + 1),
    outcome: outcome({ score, max_tile: score * 100, effective_moves: score }),
  }));
  const aggregate = aggregatePlayEpisodes("2048", episodes);
  assert.ok(aggregate.metrics);
  const metrics = aggregate.metrics;
  assert.equal(metrics.primary_metric, "mean_score");
  const meanMetrics = metrics as PlayMeanScoreMetrics;
  const rawMean = scores.reduce((a, b) => a + b, 0) / scores.length;
  assert.equal(meanMetrics.mean_score, rawMean);
  assert.deepEqual(meanMetrics.episode_scores, scores);
  // The canonical standard deviation keeps its full precision; display rounds it.
  assert.notEqual(
    meanMetrics.score_standard_deviation,
    roundPlayMetric(meanMetrics.score_standard_deviation),
  );
  const display = roundPlayMetricsForDisplay(meanMetrics) as PlayMeanScoreMetrics;
  assert.equal(
    display.score_standard_deviation,
    roundPlayMetric(meanMetrics.score_standard_deviation),
  );
});

test("per-game decision budget and primary metric are constant", () => {
  assert.equal(PLAY_MAX_DECISIONS["2048"], 200);
  assert.equal(PLAY_MAX_DECISIONS.minesweeper, 128);
  assert.equal(PLAY_PRIMARY_METRIC["2048"], "mean_score");
  assert.equal(PLAY_PRIMARY_METRIC.minesweeper, "win_rate");
});
