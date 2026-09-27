import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  FlatSeriesResultBuildV3Schema,
  FlatSeriesResultPlayV3Schema,
  LiteSeriesResultSchema,
  aggregatePlayEpisodes,
  flatBuildV3FromLite,
  flatBuildV3ToLite,
  readFlatSeriesResult,
  summarizeLiteBuild,
  type LiteTaskResult,
  type PlayEpisodeSummary,
  type PlayGameMetrics,
  type PlayOutcome,
} from "../src/index.js";
import { findRepositoryRoot } from "../src/tasks.js";

const hash = (input: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(input).digest("hex")}`;

const agent = {
  id: "pi",
  version: "0.84.3",
  model: "gpt-5.6-luna",
  harness: "pi",
  parameters: {},
};

const envelope = {
  benchmark_version: "0.7.0",
  release_hash: hash("r"),
  series_id: "01K00000000000000000000000",
  git_commit: "a".repeat(40),
  source_tree_clean: true,
  profile: "official",
  configuration: { agent, prompt_language: "en" },
  started_at: "2026-09-06T00:00:00.000Z",
  finished_at: "2026-09-06T01:00:00.000Z",
};

function outcome(overrides: Partial<PlayOutcome> = {}): PlayOutcome {
  return {
    terminal: true,
    won: true,
    score: 100,
    max_tile: 2048,
    effective_moves: 50,
    ...overrides,
  };
}

function episode(
  index: number,
  seed: number,
  outcomeValue?: PlayOutcome,
): PlayEpisodeSummary {
  return {
    episode_index: index,
    seed,
    status: "complete",
    termination: { kind: "game-over" },
    outcome: outcomeValue ?? outcome(),
    action_count: 10,
  };
}

function playGames(): {
  episodes: PlayEpisodeSummary[];
  metrics: PlayGameMetrics;
} {
  const episodes = Array.from({ length: 10 }, (_, index) =>
    episode(index, index + 1),
  );
  const aggregate = aggregatePlayEpisodes("2048", episodes);
  assert.ok(aggregate.metrics);
  return { episodes, metrics: aggregate.metrics };
}

test("a complete play result reports per-game metrics without play.score", () => {
  const { episodes, metrics } = playGames();
  const result = FlatSeriesResultPlayV3Schema.parse({
    schema_version: 3,
    suite: "play",
    ...envelope,
    games: [
      {
        task_id: "play.2048.v1",
        task_version: "1.0.0",
        game: "2048",
        game_hash: hash("g"),
        artifact_manifest_hash: hash("artifacts"),
        protocol: "play-visual-v1",
        trajectory_hash: hash("t"),
        episodes,
        coverage: { completed: 10, required: 10 },
        metrics,
      },
    ],
  });
  assert.equal(result.suite, "play");
  assert.equal(result.games[0]!.metrics!.primary_metric, "mean_score");
  assert.ok(!("score" in result.games[0]!));
});

test("a play result withholds metrics for an incomplete series", () => {
  const episodes = Array.from({ length: 9 }, (_, index) =>
    episode(index, index + 1),
  );
  const incomplete = {
    schema_version: 3,
    suite: "play",
    ...envelope,
    games: [
      {
        task_id: "play.2048.v1",
        task_version: "1.0.0",
        game: "2048",
        game_hash: hash("g"),
        artifact_manifest_hash: hash("artifacts"),
        protocol: "play-visual-v1",
        trajectory_hash: hash("t"),
        episodes,
        coverage: { completed: 9, required: 10 },
      },
    ],
  };
  assert.equal(FlatSeriesResultPlayV3Schema.safeParse(incomplete).success, true);
  assert.equal(
    FlatSeriesResultPlayV3Schema.safeParse({
      ...incomplete,
      games: [
        { ...incomplete.games[0], metrics: { primary_metric: "mean_score", mean_score: 1, episode_scores: [1], score_standard_deviation: 0, max_tile: 1, effective_moves: 1 } },
      ],
    }).success,
    false,
  );
});

test("a play result rejects game/metric mismatch and duplicate seeds", () => {
  const { episodes, metrics } = playGames();
  // Minesweeper game but 2048 mean_score metrics is rejected.
  assert.equal(
    FlatSeriesResultPlayV3Schema.safeParse({
      schema_version: 3,
      suite: "play",
      ...envelope,
      games: [
        {
          task_id: "play.minesweeper.v1",
          task_version: "1.0.0",
          game: "minesweeper",
          game_hash: hash("g"),
        artifact_manifest_hash: hash("artifacts"),
          protocol: "play-visual-v1",
          trajectory_hash: hash("t"),
          episodes,
          coverage: { completed: 10, required: 10 },
          metrics,
        },
      ],
    }).success,
    false,
  );
  // Duplicate seeds across a game's episodes are rejected.
  assert.equal(
    FlatSeriesResultPlayV3Schema.safeParse({
      schema_version: 3,
      suite: "play",
      ...envelope,
      games: [
        {
          task_id: "play.2048.v1",
          task_version: "1.0.0",
          game: "2048",
          game_hash: hash("g"),
        artifact_manifest_hash: hash("artifacts"),
          protocol: "play-visual-v1",
          trajectory_hash: hash("t"),
          episodes: episodes.map((value) => ({ ...value, seed: 7 })),
          coverage: { completed: 10, required: 10 },
          metrics,
        },
      ],
    }).success,
    false,
  );
});

function liteTask(index: number, percent: number): LiteTaskResult {
  const id = `build.sample-${index}.v1`;
  const taskHash = hash(`task-${index}`);
  return {
    task_id: id,
    task_version: "1.0.0",
    task_hash: taskHash,
    source_hash: hash(`source-${index}`),
    agent: {
      invocation: 1,
      started_at: "2026-08-30T00:00:00.000Z",
      finished_at: "2026-08-30T00:01:00.000Z",
      wall_time_ms: 60_000,
      exit_reason: "completed",
    },
    evaluation: {
      seed: 104729,
      status: "scored",
      score: {
        schema_version: 1,
        task_id: id,
        task_hash: taskHash,
        earned: percent,
        available: 100,
        percent,
        hard_gate_failed: false,
        categories: { mechanics: { earned: percent, available: 100 } },
        tests: [],
      },
    },
    artifact_manifest_hash: hash(`art-${index}`),
  };
}

function buildResult() {
  const tasks = [1, 2, 3, 4].map((index) => liteTask(index, 100 - index * 10));
  return {
    schema_version: 3,
    suite: "build",
    benchmark: "carrick-ai-gamebench",
    ...envelope,
    tasks,
    build: summarizeLiteBuild(tasks, 4),
  };
}

test("a build flat result preserves full Lite provenance and equal-weight score", () => {
  const result = buildResult();
  assert.equal(FlatSeriesResultBuildV3Schema.safeParse(result).success, true);
  // Provenance is intact (agent invocation, evaluation seed/status, artifact hash).
  assert.equal(result.tasks[0]!.agent.invocation, 1);
  assert.equal(result.tasks[0]!.evaluation.seed, 104729);
  assert.equal(result.tasks[0]!.evaluation.status, "scored");
  assert.match(result.tasks[0]!.artifact_manifest_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.build.score, 75);
  // A tampered score at complete coverage is rejected.
  assert.equal(
    FlatSeriesResultBuildV3Schema.safeParse({
      ...result,
      build: { ...result.build, score: 86 },
    }).success,
    false,
  );
  // Dropping a task loses provenance and is rejected (Lite requires 4).
  assert.equal(
    FlatSeriesResultBuildV3Schema.safeParse({
      ...buildResult(),
      tasks: buildResult().tasks.slice(0, 3),
    }).success,
    false,
  );
});

test("converting historical Lite results to v3 and back is lossless", async () => {
  const root = await findRepositoryRoot();
  const liteRoot = path.join(root, "results", "lite");
  const versions = (await readdir(liteRoot)).filter((name) => name !== "index.json");
  assert.ok(versions.length > 0, "found versioned lite result directories");
  for (const version of versions) {
    const dir = path.join(liteRoot, version);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    for (const name of files) {
      const original = LiteSeriesResultSchema.parse(
        JSON.parse(await readFile(path.join(dir, name), "utf8")),
      );
      const v3 = flatBuildV3FromLite(original);
      // The v3 projection is itself a valid v3 Build result.
      const parsedV3 = FlatSeriesResultBuildV3Schema.parse(JSON.parse(JSON.stringify(v3)));
      assert.equal(parsedV3.suite, "build");
      assert.equal(parsedV3.tasks.length, 4);
      // Round-tripping back to v2 yields the original valid record.
      const back = flatBuildV3ToLite(parsedV3);
      const reparsed = LiteSeriesResultSchema.parse(JSON.parse(JSON.stringify(back)));
      assert.deepEqual(reparsed, original);
    }
  }
});

test("readFlatSeriesResult dispatches by exact schema version", () => {
  assert.throws(() => readFlatSeriesResult({ schema_version: 9 }), /Unrecognized/);
});

test("legacy v2 results are preserved and dispatched without rewriting", () => {
  const liteTask = (index: number) => ({
    task_id: `build.sample-${index}.v1`,
    task_version: "1.0.0",
    task_hash: hash(String(index)),
    source_hash: hash("s"),
    agent: {
      invocation: 1,
      started_at: "2026-08-30T00:00:00.000Z",
      finished_at: "2026-08-30T00:01:00.000Z",
      wall_time_ms: 60_000,
      exit_reason: "completed",
    },
    evaluation: { seed: 104729, status: "not-run" as const },
    artifact_manifest_hash: hash("a"),
  });
  const legacy = LiteSeriesResultSchema.parse({
    schema_version: 2,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: "0.6.0",
    release_hash: hash("c"),
    series_id: "01M00000000000000000000000",
    git_commit: "d".repeat(40),
    source_tree_clean: true,
    profile: "official",
    configuration: { agent, prompt_language: "en" },
    started_at: "2026-08-30T00:00:00.000Z",
    finished_at: "2026-08-30T01:00:00.000Z",
    tasks: [1, 2, 3, 4].map(liteTask),
    build: { completed: 0, required: 4 },
  });
  const read = readFlatSeriesResult(JSON.parse(JSON.stringify(legacy)));
  assert.equal(read.schema_version, 2);
});
