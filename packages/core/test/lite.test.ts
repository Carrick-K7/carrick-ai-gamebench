import assert from "node:assert/strict";
import test from "node:test";
import {
  LITE_EVALUATION_SEED,
  LiteReleaseLockSchema,
  LiteResultIndexSchema,
  LiteSeriesResultSchema,
  summarizeLiteBuild,
  type LiteTaskResult,
} from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function task(index: number, percent = 100): LiteTaskResult {
  const id = `build.sample-${index}.v1`;
  return {
    task_id: id,
    task_version: "1.0.0",
    task_hash: hash(String(index)) as `sha256:${string}`,
    source_hash: hash("a") as `sha256:${string}`,
    agent: {
      invocation: 1,
      started_at: "2026-08-30T00:00:00.000Z",
      finished_at: "2026-08-30T00:01:00.000Z",
      wall_time_ms: 60_000,
      exit_reason: "completed",
    },
    evaluation: {
      seed: LITE_EVALUATION_SEED,
      status: "scored",
      score: {
        schema_version: 1,
        task_id: id,
        task_hash: hash(String(index)),
        earned: percent,
        available: 100,
        percent,
        hard_gate_failed: false,
        categories: { mechanics: { earned: percent, available: 100 } },
        tests: [],
      },
    },
    artifact_manifest_hash: hash("b") as `sha256:${string}`,
  };
}

test("Lite release requires exactly four sorted Build tasks and the canonical seed", () => {
  const valid = {
    schema_version: 1,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: "0.6.0",
    evaluation_seed: LITE_EVALUATION_SEED,
    agent_invocations_per_task: 1,
    scoring: { primary_board: "build", task_weighting: "equal" },
    tasks: [1, 2, 3, 4].map((index) => ({
      id: `build.sample-${index}.v1`,
      version: "1.0.0",
      hash: hash(String(index)),
    })),
  };
  assert.equal(LiteReleaseLockSchema.safeParse(valid).success, true);
  assert.equal(
    LiteReleaseLockSchema.safeParse({ ...valid, evaluation_seed: 1 }).success,
    false,
  );
  assert.equal(
    LiteReleaseLockSchema.safeParse({ ...valid, tasks: valid.tasks.slice(0, 3) }).success,
    false,
  );
  assert.equal(
    LiteReleaseLockSchema.safeParse({
      ...valid,
      tasks: [{ ...valid.tasks[0], id: "reproduce.sample.v1" }, ...valid.tasks.slice(1)],
    }).success,
    false,
  );
});

test("Lite index accepts only canonical unique result paths", () => {
  const entry = {
    benchmark_version: "0.6.0",
    series_id: "01M00000000000000000000000",
    path: "results/lite/0.6.0/01M00000000000000000000000.json",
  };
  assert.equal(
    LiteResultIndexSchema.safeParse({ schema_version: 1, results: [entry] }).success,
    true,
  );
  assert.equal(
    LiteResultIndexSchema.safeParse({
      schema_version: 1,
      results: [{ ...entry, path: "../../secret.json" }],
    }).success,
    false,
  );
  assert.equal(
    LiteResultIndexSchema.safeParse({ schema_version: 1, results: [entry, entry] }).success,
    false,
  );
});

test("Lite result reports one equal-weight Build score only at four-of-four coverage", () => {
  const tasks = [task(1, 100), task(2, 90), task(3, 80), task(4, 70)];
  const base = {
    schema_version: 2,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: "0.6.0",
    release_hash: hash("c"),
    series_id: "01M00000000000000000000000",
    git_commit: "d".repeat(40),
    source_tree_clean: true,
    profile: "official",
    configuration: {
      agent: {
        id: "agent",
        version: "1",
        model: "model",
        harness: "shell",
        parameters: {},
      },
      prompt_language: "en",
    },
    started_at: "2026-08-30T00:00:00.000Z",
    finished_at: "2026-08-30T01:00:00.000Z",
    tasks,
    build: summarizeLiteBuild(tasks, 4),
  };
  const parsed = LiteSeriesResultSchema.parse(base);
  assert.equal(parsed.build.score, 85);
  assert.equal(
    LiteSeriesResultSchema.safeParse({
      ...base,
      campaign: {
        id: "pi-baseline",
        cell_id: "sol",
        plan_hash: hash("e"),
        execution_hash: hash("f"),
      },
    }).success,
    true,
  );
  assert.equal(
    LiteSeriesResultSchema.safeParse({
      ...base,
      campaign: {
        id: "../escape",
        cell_id: "sol",
        plan_hash: hash("e"),
        execution_hash: hash("f"),
      },
    }).success,
    false,
  );
  assert.equal(
    LiteSeriesResultSchema.safeParse({ ...base, build: { ...base.build, score: 90 } }).success,
    false,
  );
  assert.equal(
    LiteSeriesResultSchema.safeParse({
      ...base,
      tasks: tasks.slice(0, 3),
      build: { completed: 3, required: 4 },
    }).success,
    false,
  );
  assert.equal(
    LiteSeriesResultSchema.safeParse({
      ...base,
      tasks: [tasks[0], tasks[0], tasks[2], tasks[3]],
    }).success,
    false,
  );
  assert.equal(
    LiteSeriesResultSchema.safeParse({
      ...base,
      tasks: [
        { ...tasks[0], evaluation: { ...tasks[0]!.evaluation, seed: 7 } },
        ...tasks.slice(1),
      ],
    }).success,
    false,
  );
  assert.equal(
    LiteSeriesResultSchema.safeParse({
      ...base,
      tasks: [
        {
          ...tasks[0],
          evaluation: {
            ...tasks[0]!.evaluation,
            score: { ...tasks[0]!.evaluation.score!, task_id: "build.other.v1" },
          },
        },
        ...tasks.slice(1),
      ],
    }).success,
    false,
  );
});
