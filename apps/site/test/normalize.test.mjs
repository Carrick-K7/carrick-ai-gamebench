import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublication, normalizeResultEntry } from "../src/lib/normalize.ts";

const hash = `sha256:${"a".repeat(64)}`;
const artifact = {
  artifact_id: hash,
  role: "playable",
  file_name: "game.html",
  size_bytes: 10,
  media_type: "text/html",
  url: "https://play.example/game",
};
const score = {
  schema_version: 1,
  task_id: "build.game.v2",
  task_hash: hash,
  earned: 90,
  available: 100,
  percent: 90,
  hard_gate_failed: false,
  categories: {},
  tests: [],
};
const coverage = {
  build: { completed: 1, required: 1 },
  reproduce: { completed: 0, required: 0 },
  core: { completed: 1, required: 1 },
};
const common = {
  publication_id: hash,
  created_at: "2026-01-01T00:00:00.000Z",
  tier: "experimental",
  series_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  benchmark: { version: "0.3.0", release_hash: hash, git_commit: "a".repeat(40) },
  configuration: {
    configuration_id: hash,
    agent: { id: "agent", version: "1", model: "model", harness: "shell", parameters: {} },
    prompt_language: "en",
    execution_profile: "local",
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22",
      runner_protocol: "2",
      git_commit: "a".repeat(40),
      source_tree_dirty: false,
    },
  },
  review_summaries: [],
};

test("normalizes v1 attempts without changing historical result and showcase identities", () => {
  const publication = normalizePublication({
    ...common,
    schema_version: 1,
    aggregate: {
      schema_version: 2,
      tasks: [{ task_id: "build.game.v2", track: "build", attempts: 1, mean: 90, standard_deviation: 0 }],
      coverage,
      leaderboards: { build: 90, core: 90 },
    },
    runs: [{
      run_id: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
      input_fingerprint: hash,
      task_id: "build.game.v2",
      task_version: "2.0.0",
      task_hash: hash,
      seed: 104729,
      attempt: 1,
      included: true,
      network_policy: "full",
      exit_reason: "completed",
      score,
      artifacts: [artifact],
    }],
  });

  assert.equal(publication.publication_id, hash);
  assert.equal(publication.aggregate.primary_board, "core");
  assert.equal(publication.aggregate.tasks[0].development_count, 1);
  assert.equal(publication.runs[0].run_id, "01ARZ3NDEKTSV4RRFFQ69G5FAA");
  assert.equal(publication.runs[0].artifacts[0].artifact_id, hash);
  assert.equal(publication.runs[0].legacy_attempt, 1);
});

test("normalizes one v2 development submission and three evaluations into the shared view", () => {
  const rawPublication = {
    ...common,
    schema_version: 2,
    board: "build",
    benchmark: { ...common.benchmark, version: "0.5.0" },
    configuration: {
      ...common.configuration,
      execution_profile: "official-candidate",
      environment: { ...common.configuration.environment, runner_protocol: "3" },
    },
    aggregate: {
      schema_version: 3,
      primary_board: "build",
      tasks: [{
        task_id: "build.game.v2",
        track: "build",
        submission_id: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
        evaluation_count: 3,
        required_evaluation_count: 3,
        mean: 90,
        standard_deviation: 0,
      }],
      coverage,
      evaluation_coverage: {
        build: { completed: 3, required: 3 },
        reproduce: { completed: 0, required: 0 },
        core: { completed: 3, required: 3 },
      },
      leaderboards: { build: 90, reproduce: 70 },
    },
    submissions: [{
      submission_id: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
      development_input_fingerprint: hash,
      source_snapshot_hash: hash,
      task_id: "build.game.v2",
      task_version: "2.0.0",
      task_hash: hash,
      agent_invocation_index: 1,
      included: true,
      network_policy: "full",
      development_exit_reason: "completed",
      artifacts: [artifact],
      evaluations: [104729, 130363, 155921].map((evaluation_seed, index) => ({
        run_id: `01ARZ3NDEKTSV4RRFFQ69G5FA${String.fromCharCode(67 + index)}`,
        input_fingerprint: hash,
        evaluation_seed,
        included: true,
        exit_reason: "completed",
        score,
        artifacts: [],
      })),
    }],
  };
  const publication = normalizePublication(rawPublication);

  assert.equal(publication.aggregate.primary_board, "build");
  assert.equal(publication.submissions.length, 1);
  assert.equal(publication.runs.length, 3);
  assert.deepEqual(publication.runs.map(({ seed }) => seed), [104729, 130363, 155921]);
  assert.ok(publication.runs.every((run) => run.submission_id === "01ARZ3NDEKTSV4RRFFQ69G5FAB"));
  assert.ok(publication.runs.every((run) => run.artifacts[0].artifact_id === hash));

  const reproducePublication = normalizePublication({
    ...rawPublication,
    board: "reproduce",
    aggregate: {
      ...rawPublication.aggregate,
      tasks: rawPublication.aggregate.tasks.map((task) => ({
        ...task,
        task_id: "reproduce.game.v2",
        track: "reproduce",
      })),
      coverage: {
        build: { completed: 0, required: 0 },
        reproduce: { completed: 1, required: 1 },
      },
      evaluation_coverage: {
        build: { completed: 0, required: 0 },
        reproduce: { completed: 3, required: 3 },
      },
      leaderboards: { reproduce: 90 },
    },
  });
  assert.equal(reproducePublication.aggregate.primary_board, "reproduce");
  assert.equal(reproducePublication.aggregate.leaderboards.reproduce, 90);

  const entry = normalizeResultEntry({
    publication_id: hash,
    created_at: common.created_at,
    tier: "experimental",
    status: "active",
    benchmark_version: "0.5.0",
    series_id: common.series_id,
    configuration_id: hash,
    agent: common.configuration.agent,
    aggregate: publication.aggregate,
  }, publication);
  assert.equal(entry.aggregate.leaderboards.build, 90);
  assert.equal(entry.publication_id, publication.publication_id);
});
