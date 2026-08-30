import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAttempts,
  aggregateEvaluationsV3,
  assertScoreResult,
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

test("score arithmetic assertion rejects internally consistent-looking tampering", () => {
  const taskHash = `sha256:${"a".repeat(64)}`;
  const score = scoreTask(buildTask, taskHash, [
    { id: "build", passed: true, duration_ms: 1, artifacts: [] },
    { id: "mechanics", passed: false, duration_ms: 1, artifacts: [] },
  ]);
  assert.doesNotThrow(() => assertScoreResult(buildTask, taskHash, score));
  assert.throws(
    () => assertScoreResult(buildTask, taskHash, { ...score, percent: 99 }),
    /score percent mismatch/,
  );
  assert.throws(
    () => assertScoreResult(buildTask, taskHash, { ...score, percent: 5.00001 }),
    /score percent mismatch/,
  );
  assert.throws(
    () => assertScoreResult(buildTask, taskHash, {
      ...score,
      categories: {
        ...score.categories,
        mechanics: { earned: 95, available: 95 },
      },
    }),
    /mechanics earned mismatch/,
  );
});

test("aggregate v3 averages three seeds from one submission", () => {
  const taskHash = `sha256:${"a".repeat(64)}`;
  const submissionId = "01K00000000000000000000000";
  const scoreFor = (build: boolean, mechanics: boolean) =>
    scoreTask(buildTask, taskHash, [
      { id: "build", passed: build, duration_ms: 1, artifacts: [] },
      { id: "mechanics", passed: mechanics, duration_ms: 1, artifacts: [] },
    ]);
  const result = aggregateEvaluationsV3(
    [
      { task: buildTask, task_hash: taskHash, submission_id: submissionId, evaluation_seed: 104729, score: scoreFor(true, true) },
      { task: buildTask, task_hash: taskHash, submission_id: submissionId, evaluation_seed: 130363, score: scoreFor(true, false) },
      { task: buildTask, task_hash: taskHash, submission_id: submissionId, evaluation_seed: 155921, score: scoreFor(false, true) },
    ],
    [{ task: buildTask, task_hash: taskHash }],
    [104729, 130363, 155921],
  );
  assert.equal(result.schema_version, 3);
  assert.equal(result.primary_board, "build");
  assert.equal(result.tasks[0]?.evaluation_count, 3);
  assert.equal(result.tasks[0]?.mean, 35);
  assert.equal(result.leaderboards.build, 35);
  assert.deepEqual(result.evaluation_coverage.build, { completed: 3, required: 3 });
});

test("aggregate v3 rejects duplicate seeds and mixed submissions", () => {
  const taskHash = `sha256:${"a".repeat(64)}`;
  const score = scoreTask(buildTask, taskHash, [
    { id: "build", passed: true, duration_ms: 1, artifacts: [] },
    { id: "mechanics", passed: true, duration_ms: 1, artifacts: [] },
  ]);
  const base = {
    task: buildTask,
    task_hash: taskHash,
    submission_id: "01K00000000000000000000000",
    evaluation_seed: 104729,
    score,
  };
  assert.throws(
    () => aggregateEvaluationsV3([base, base], [{ task: buildTask, task_hash: taskHash }], [104729, 130363, 155921]),
    /duplicate evaluation cell/,
  );
  assert.throws(
    () => aggregateEvaluationsV3([
      base,
      { ...base, submission_id: "01K00000000000000000000001", evaluation_seed: 130363 },
    ], [{ task: buildTask, task_hash: taskHash }], [104729, 130363, 155921]),
    /multiple submissions/,
  );
});

test("aggregate v3 withholds boards for incomplete seed coverage", () => {
  const taskHash = `sha256:${"a".repeat(64)}`;
  const score = scoreTask(buildTask, taskHash, [
    { id: "build", passed: true, duration_ms: 1, artifacts: [] },
    { id: "mechanics", passed: true, duration_ms: 1, artifacts: [] },
  ]);
  const result = aggregateEvaluationsV3([{
    task: buildTask,
    task_hash: taskHash,
    submission_id: "01K00000000000000000000000",
    evaluation_seed: 104729,
    score,
  }], [{ task: buildTask, task_hash: taskHash }], [104729, 130363, 155921]);
  assert.equal(result.leaderboards.build, undefined);
  assert.deepEqual(result.coverage.build, { completed: 0, required: 1 });
  assert.deepEqual(result.evaluation_coverage.build, { completed: 1, required: 3 });
});
