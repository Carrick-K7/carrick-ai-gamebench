import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAttempts,
  scoreTask,
  type TaskManifest,
} from "../src/index.js";

const buildTask: TaskManifest = {
  schema_version: 1,
  id: "build.sample.v1",
  version: "1.0.0",
  title: { en: "Sample", zh: "示例" },
  track: "build",
  level: 1,
  prompt: { en: "prompt.en.md", zh: "prompt.zh.md" },
  starter: "vite-ts",
  budget_seconds: 3600,
  network_policy: "full",
  runtime: {
    node: "22",
    package_manager: "pnpm",
    port: 4173,
    viewport: [1280, 720],
    device_scale_factor: 1,
  },
  test_suite: "tests/cases.json",
  bridge: {
    version: "1",
    state_schema: "state.schema.json",
  },
  tests: [
    { id: "build", category: "build", points: 5, case: "build" },
    {
      id: "mechanics",
      category: "mechanics",
      points: 95,
      case: "mechanics",
    },
  ],
};

test("a failed build hard-gates the complete task", () => {
  const result = scoreTask(buildTask, "sha256:test", [
    { id: "build", passed: false, duration_ms: 10, artifacts: [] },
    { id: "mechanics", passed: true, duration_ms: 20, artifacts: [] },
  ]);
  assert.equal(result.percent, 0);
  assert.equal(result.hard_gate_failed, true);
});

test("scoring uses declared atomic points", () => {
  const result = scoreTask(buildTask, "sha256:test", [
    { id: "build", passed: true, duration_ms: 10, artifacts: [] },
    { id: "mechanics", passed: false, duration_ms: 20, artifacts: [] },
  ]);
  assert.equal(result.percent, 5);
  assert.equal(result.categories.build?.earned, 5);
});

test("aggregation reports mean, population deviation, and core", () => {
  const first = scoreTask(buildTask, "sha256:test", [
    { id: "build", passed: true, duration_ms: 1, artifacts: [] },
    { id: "mechanics", passed: true, duration_ms: 1, artifacts: [] },
  ]);
  const second = {
    ...first,
    earned: 50,
    percent: 50,
  };
  const result = aggregateAttempts(
    [
      { task: buildTask, score: first },
      { task: buildTask, score: second },
    ],
    [buildTask],
  );
  assert.equal(result.tasks[0]?.mean, 75);
  assert.equal(result.tasks[0]?.standard_deviation, 25);
  assert.equal(result.leaderboards.build, 75);
  assert.equal(result.leaderboards.core, 75);
  assert.deepEqual(result.coverage.core, { completed: 1, required: 1 });
});

test("incomplete tracks do not publish misleading leaderboard scores", () => {
  const otherTask: TaskManifest = {
    ...buildTask,
    id: "build.other.v1",
    title: { en: "Other", zh: "其他" },
  };
  const score = scoreTask(buildTask, `sha256:${"a".repeat(64)}`, [
    { id: "build", passed: true, duration_ms: 1, artifacts: [] },
    { id: "mechanics", passed: true, duration_ms: 1, artifacts: [] },
  ]);
  const result = aggregateAttempts(
    [{ task: buildTask, score }],
    [buildTask, otherTask],
  );
  assert.equal(result.leaderboards.build, undefined);
  assert.equal(result.leaderboards.core, undefined);
  assert.deepEqual(result.coverage.build, { completed: 1, required: 2 });
});

test("Core gives Build and Reproduce equal weight regardless of task count", () => {
  const secondBuildTask: TaskManifest = {
    ...buildTask,
    id: "build.other.v1",
    title: { en: "Other", zh: "其他" },
  };
  const reproduceTask: TaskManifest = {
    ...buildTask,
    id: "reproduce.sample.v1",
    title: { en: "Reference", zh: "复刻" },
    track: "reproduce",
    network_policy: "model-api-only",
  };
  const perfect = (task: TaskManifest) =>
    scoreTask(task, "sha256:test", [
      { id: "build", passed: true, duration_ms: 1, artifacts: [] },
      { id: "mechanics", passed: true, duration_ms: 1, artifacts: [] },
    ]);
  const zero = scoreTask(reproduceTask, "sha256:test", [
    { id: "build", passed: false, duration_ms: 1, artifacts: [] },
    { id: "mechanics", passed: true, duration_ms: 1, artifacts: [] },
  ]);

  const result = aggregateAttempts(
    [
      { task: buildTask, score: perfect(buildTask) },
      { task: secondBuildTask, score: perfect(secondBuildTask) },
      { task: reproduceTask, score: zero },
    ],
    [buildTask, secondBuildTask, reproduceTask],
  );

  assert.equal(result.leaderboards.build, 100);
  assert.equal(result.leaderboards.reproduce, 0);
  assert.equal(result.leaderboards.core, 50);
});
