import assert from "node:assert/strict";
import test from "node:test";
import {
  AggregateResultV3Schema,
  TaskManifestSchema,
  TestSuiteSchema,
  TrackSchema,
  RunManifestV2Schema,
  RunManifestV3Schema,
  PublicationManifestV2Schema,
  SeriesManifestV2Schema,
  SubmissionManifestV1Schema,
  VoteSchema,
} from "../src/index.js";

test("task manifests reject unknown keys", () => {
  const result = TaskManifestSchema.safeParse({
    schema_version: 1,
    unexpected: true,
  });
  assert.equal(result.success, false);
});

test("task manifests reject escaping and non-portable paths", () => {
  const base = {
    schema_version: 1,
    id: "build.example.v1",
    version: "1.0.0",
    title: { en: "Example", zh: "示例" },
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
    bridge: { version: "1", state_schema: "state.schema.json" },
    tests: [{ id: "build", category: "build", points: 100, case: "build" }],
  };
  assert.equal(
    TaskManifestSchema.safeParse({
      ...base,
      prompt: { ...base.prompt, en: "../prompt.md" },
    }).success,
    false,
  );
  assert.equal(
    TaskManifestSchema.safeParse({
      ...base,
      bridge: { ...base.bridge, state_schema: "schema\\state.json" },
    }).success,
    false,
  );
});

test("public suites reject duplicate case identities across both case kinds", () => {
  const build = { id: "same", kind: "build", description: "Build gate" };
  const browser = {
    id: "same", kind: "browser", description: "Browser check",
    steps: [{ op: "expect", path: "score", equals: 0 }],
  };
  for (const cases of [[build, build], [browser, browser], [build, browser], [browser, build]]) {
    const result = TestSuiteSchema.safeParse({ schema_version: 1, cases });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.message === "duplicate case id: same"));
    }
  }
});

test("case identities are safe single artifact-directory segments", () => {
  for (const id of ["../outside", "/absolute", "nested/case", "nested\\case", ".", "..", "case\u0000"]) {
    assert.equal(TestSuiteSchema.safeParse({
      schema_version: 1,
      cases: [{ id, kind: "build", description: "Build gate" }],
    }).success, false, id);
  }
  assert.equal(TestSuiteSchema.safeParse({
    schema_version: 1,
    cases: [{ id: "valid-case.v1", kind: "build", description: "Build gate" }],
  }).success, true);
});

test("browser cases require an observation rather than an automatic pass", () => {
  const suite = (steps: object[]) => ({
    schema_version: 1,
    cases: [{ id: "case", kind: "browser", description: "Case", steps }],
  });
  for (const steps of [[], [{ op: "reset" }], [{ op: "key", key: "ArrowLeft" }]]) {
    assert.equal(TestSuiteSchema.safeParse(suite(steps)).success, false);
  }
  for (const equals of [null, false, 0]) {
    assert.equal(TestSuiteSchema.safeParse(suite([
      { op: "expect", path: "state.value", equals },
    ])).success, true);
  }
  assert.equal(TestSuiteSchema.safeParse(suite([
    { op: "screenshot", name: "board.png" },
  ])).success, true);
});

test("public browser cases reject ambiguous runtime operations", () => {
  const suite = (step: object) => ({
    schema_version: 1,
    cases: [{
      id: "case",
      kind: "browser",
      description: "case",
      steps: [step, { op: "expect", path: "score", equals: 0 }],
    }],
  });

  assert.equal(
    TestSuiteSchema.safeParse(suite({
      op: "expect",
      path: "seed",
      equals: 1,
      equals_run_seed: true,
    })).success,
    false,
  );
  assert.equal(
    TestSuiteSchema.safeParse(suite({
      op: "screenshot",
      name: "capture.png",
      max_diff_pixels: 100,
      max_diff_ratio: 0.01,
    })).success,
    false,
  );
  assert.equal(
    TestSuiteSchema.safeParse(suite({
      op: "click",
      x: 10,
    })).success,
    false,
  );
});

test("run manifest v2 has immutable identity and no self-verified flag", () => {
  const run = {
    schema_version: 2,
    benchmark_version: "0.2.0",
    benchmark_release_hash: `sha256:${"a".repeat(64)}`,
    series_id: "01K00000000000000000000000",
    run_id: "01K00000000000000000000001",
    configuration_id: `sha256:${"b".repeat(64)}`,
    input_fingerprint: `sha256:${"c".repeat(64)}`,
    task_id: "build.2048.v1",
    task_version: "1.0.0",
    task_hash: `sha256:${"d".repeat(64)}`,
    attempt: 1,
    seed: 104729,
    execution_profile: "local",
    prompt_language: "en",
    network_policy: "full",
    agent: {
      id: "codex",
      version: "1",
      model: "gpt",
      harness: "cli",
      parameters: {},
    },
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "2",
      git_commit: "e".repeat(40),
      source_tree_dirty: false,
    },
    started_at: "2026-07-19T00:00:00.000Z",
  };
  assert.equal(RunManifestV2Schema.safeParse(run).success, true);
  assert.equal(
    RunManifestV2Schema.safeParse({ ...run, verified: true }).success,
    false,
  );
});

test("v0.5 submission and evaluation manifests keep seed out of development", () => {
  const hash = (character: string) => `sha256:${character.repeat(64)}`;
  const submission = {
    schema_version: 1,
    benchmark_version: "0.5.0",
    benchmark_release_hash: hash("a"),
    series_id: "01K00000000000000000000000",
    submission_id: "01K00000000000000000000001",
    configuration_id: hash("b"),
    development_input_fingerprint: hash("c"),
    agent_command_hash: hash("1"),
    development_parameters: { agent_command_hash: hash("1") },
    task_id: "build.sample.v1",
    task_version: "1.0.0",
    task_hash: hash("d"),
    agent_invocation_index: 1,
    execution_profile: "official-candidate",
    prompt_language: "en",
    network_policy: "full",
    agent: {
      id: "agent",
      version: "1",
      model: "model",
      harness: "cli",
      parameters: {},
    },
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "3",
      git_commit: "e".repeat(40),
      source_tree_dirty: false,
    },
    started_at: "2026-07-19T00:00:00.000Z",
    finished_at: "2026-07-19T01:00:00.000Z",
    development_exit_reason: "completed",
    source_snapshot_hash: hash("f"),
  };
  assert.equal(SubmissionManifestV1Schema.safeParse(submission).success, true);
  const { agent_command_hash: _commandHash, ...withoutCommandHash } = submission;
  assert.equal(SubmissionManifestV1Schema.safeParse(withoutCommandHash).success, false);
  assert.equal(
    SubmissionManifestV1Schema.safeParse({
      ...submission,
      agent_command_hash: "./agent --secret",
    }).success,
    false,
  );
  assert.equal(
    SubmissionManifestV1Schema.safeParse({
      ...submission,
      development_parameters: { agent_command_hash: hash("2") },
    }).success,
    false,
  );
  assert.equal(
    SubmissionManifestV1Schema.safeParse({ ...submission, evaluation_seed: 104729 }).success,
    false,
  );

  const evaluation = {
    schema_version: 3,
    benchmark_version: "0.5.0",
    benchmark_release_hash: hash("a"),
    series_id: submission.series_id,
    run_id: "01K00000000000000000000002",
    submission_id: submission.submission_id,
    configuration_id: hash("b"),
    input_fingerprint: hash("1"),
    task_id: submission.task_id,
    task_version: submission.task_version,
    task_hash: hash("d"),
    evaluation_seed: 104729,
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "3",
      git_commit: "e".repeat(40),
      source_tree_dirty: false,
    },
    started_at: "2026-07-19T01:00:00.000Z",
  };
  assert.equal(RunManifestV3Schema.safeParse(evaluation).success, true);
});

test("run manifest v2 remains strict and rejects v0.5 identity fields", () => {
  const legacy = {
    schema_version: 2,
    benchmark_version: "0.4.0",
    benchmark_release_hash: `sha256:${"a".repeat(64)}`,
    series_id: "01K00000000000000000000000",
    run_id: "01K00000000000000000000001",
    configuration_id: `sha256:${"b".repeat(64)}`,
    input_fingerprint: `sha256:${"c".repeat(64)}`,
    task_id: "build.sample.v1",
    task_version: "1.0.0",
    task_hash: `sha256:${"d".repeat(64)}`,
    attempt: 1,
    seed: 104729,
    execution_profile: "local",
    prompt_language: "en",
    network_policy: "full",
    agent: { id: "agent", version: "1", model: "model", harness: "cli", parameters: {} },
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "2",
      git_commit: "e".repeat(40),
      source_tree_dirty: false,
    },
    started_at: "2026-07-19T00:00:00.000Z",
  };
  assert.equal(RunManifestV2Schema.safeParse(legacy).success, true);
  assert.equal(
    RunManifestV2Schema.safeParse({
      ...legacy,
      submission_id: "01K00000000000000000000002",
      evaluation_seed: 104729,
    }).success,
    false,
  );
});

test("series v2 validates submission/evaluation references and seed cells", () => {
  const hash = (character: string) => `sha256:${character.repeat(64)}`;
  const series = {
    schema_version: 2,
    series_id: "01K00000000000000000000000",
    benchmark_version: "0.5.0",
    benchmark_release_hash: hash("a"),
    git_commit: "e".repeat(40),
    configuration_id: hash("b"),
    configuration: {
      agent: { id: "agent", version: "1", model: "model", harness: "cli", parameters: {} },
      prompt_language: "en",
      execution_profile: "official-candidate",
      environment: {
        platform: "linux",
        architecture: "x64",
        node: "v22.12.0",
        runner_protocol: "3",
        git_commit: "e".repeat(40),
        source_tree_dirty: false,
      },
    },
    created_at: "2026-07-19T00:00:00.000Z",
    submissions: [{
      submission_id: "01K00000000000000000000001",
      task_id: "build.sample.v1",
      task_hash: hash("c"),
      agent_invocation_index: 1,
      included: true,
    }],
    evaluations: [{
      run_id: "01K00000000000000000000002",
      submission_id: "01K00000000000000000000001",
      task_id: "build.sample.v1",
      task_hash: hash("c"),
      evaluation_seed: 104729,
      included: true,
    }],
  };
  assert.equal(SeriesManifestV2Schema.safeParse(series).success, true);
  assert.equal(
    SeriesManifestV2Schema.safeParse({
      ...series,
      evaluations: [{ ...series.evaluations[0], task_id: "build.other.v1" }],
    }).success,
    false,
  );
  assert.equal(
    SeriesManifestV2Schema.safeParse({
      ...series,
      evaluations: [...series.evaluations, {
        ...series.evaluations[0],
        run_id: "01K00000000000000000000003",
      }],
    }).success,
    false,
  );
});

test("publication v2 groups seed evaluations under one submission", () => {
  const hash = (character: string) => `sha256:${character.repeat(64)}`;
  const taskHash = hash("c");
  const score = {
    schema_version: 1,
    task_id: "build.sample.v1",
    task_hash: taskHash,
    earned: 100,
    available: 100,
    percent: 100,
    hard_gate_failed: false,
    categories: { build: { earned: 100, available: 100 } },
    tests: [{
      id: "build",
      category: "build",
      points: 100,
      passed: true,
      duration_ms: 1,
      artifacts: [],
    }],
  };
  const submissionId = "01K00000000000000000000001";
  const evaluation = {
    run_id: "01K00000000000000000000002",
    input_fingerprint: hash("d"),
    evaluation_seed: 104729,
    included: true,
    exit_reason: "completed",
    score,
    artifacts: [],
  };
  const publication = {
    schema_version: 2,
    publication_id: hash("1"),
    created_at: "2026-07-19T00:00:00.000Z",
    tier: "experimental",
    board: "build",
    series_id: "01K00000000000000000000000",
    benchmark: {
      version: "0.5.0",
      release_hash: hash("a"),
      git_commit: "e".repeat(40),
    },
    configuration: {
      configuration_id: hash("b"),
      agent: { id: "agent", version: "1", model: "model", harness: "cli", parameters: {} },
      prompt_language: "en",
      execution_profile: "local",
      environment: {
        platform: "linux",
        architecture: "x64",
        node: "v22.12.0",
        runner_protocol: "3",
        git_commit: "e".repeat(40),
        source_tree_dirty: false,
      },
    },
    aggregate: {
      schema_version: 3,
      primary_board: "build",
      tasks: [{
        task_id: "build.sample.v1",
        track: "build",
        submission_id: submissionId,
        evaluation_count: 1,
        required_evaluation_count: 1,
        mean: 100,
        standard_deviation: 0,
      }],
      coverage: {
        build: { completed: 1, required: 1 },
        reproduce: { completed: 0, required: 0 },
      },
      evaluation_coverage: {
        build: { completed: 1, required: 1 },
        reproduce: { completed: 0, required: 0 },
      },
      leaderboards: { build: 100 },
    },
    submissions: [{
      submission_id: submissionId,
      development_input_fingerprint: hash("f"),
      agent_command_hash: hash("3"),
      development_parameters: { agent_command_hash: hash("3") },
      source_snapshot_hash: hash("2"),
      task_id: "build.sample.v1",
      task_version: "1.0.0",
      task_hash: taskHash,
      agent_invocation_index: 1,
      included: true,
      network_policy: "full",
      development_exit_reason: "completed",
      artifacts: [],
      evaluations: [evaluation],
    }],
    review_summaries: [],
  };
  assert.equal(PublicationManifestV2Schema.safeParse(publication).success, true);
  const reproduceTaskId = "reproduce.sample.v1";
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      board: "reproduce",
      aggregate: {
        ...publication.aggregate,
        tasks: publication.aggregate.tasks.map((task) => ({
          ...task,
          task_id: reproduceTaskId,
          track: "reproduce",
        })),
        coverage: {
          build: { completed: 0, required: 0 },
          reproduce: { completed: 1, required: 1 },
        },
        evaluation_coverage: {
          build: { completed: 0, required: 0 },
          reproduce: { completed: 1, required: 1 },
        },
        leaderboards: { reproduce: 100 },
      },
      submissions: publication.submissions.map((submission) => ({
        ...submission,
        task_id: reproduceTaskId,
        evaluations: submission.evaluations.map((publishedEvaluation) => ({
          ...publishedEvaluation,
          score: publishedEvaluation.score
            ? { ...publishedEvaluation.score, task_id: reproduceTaskId }
            : undefined,
        })),
      })),
    }).success,
    true,
  );
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      board: "reproduce",
    }).success,
    false,
  );
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      aggregate: {
        ...publication.aggregate,
        coverage: {
          ...publication.aggregate.coverage,
          reproduce: { completed: 0, required: 1 },
        },
        evaluation_coverage: {
          ...publication.aggregate.evaluation_coverage,
          reproduce: { completed: 0, required: 3 },
        },
      },
    }).success,
    false,
  );
  assert.equal(
    AggregateResultV3Schema.safeParse({
      ...publication.aggregate,
      coverage: {
        ...publication.aggregate.coverage,
        core: { completed: 1, required: 1 },
      },
    }).success,
    false,
  );
  assert.equal(
    AggregateResultV3Schema.safeParse({
      ...publication.aggregate,
      leaderboards: { ...publication.aggregate.leaderboards, core: 100 },
    }).success,
    false,
  );
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      submissions: [{
        ...publication.submissions[0],
        agent_command_hash: "bash -lc ./agent",
      }],
    }).success,
    false,
  );
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      submissions: [{
        ...publication.submissions[0],
        development_parameters: { agent_command_hash: hash("4") },
      }],
    }).success,
    false,
  );
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      aggregate: {
        ...publication.aggregate,
        tasks: [{ ...publication.aggregate.tasks[0], mean: 0 }],
        leaderboards: { build: 0 },
      },
    }).success,
    false,
  );
  assert.equal(
    PublicationManifestV2Schema.safeParse({
      ...publication,
      submissions: [{
        ...publication.submissions[0],
        evaluations: [evaluation, {
          ...evaluation,
          run_id: "01K00000000000000000000003",
        }],
      }],
    }).success,
    false,
  );
});

test("the public protocol exposes only Build and Reproduce tracks", () => {
  assert.equal(TrackSchema.safeParse("build").success, true);
  assert.equal(TrackSchema.safeParse("reproduce").success, true);
  assert.equal(TrackSchema.safeParse("iterate").success, false);
});

test("votes preserve blinded left-side assignment", () => {
  const result = VoteSchema.safeParse({
    schema_version: 1,
    benchmark_version: "1.0.0",
    task_id: "build.2048.v1",
    task_version: "1.0.0",
    prompt_language: "en",
    reviewer_id: "reviewer",
    session_id: "session",
    candidate_a_hash: `sha256:${"a".repeat(64)}`,
    candidate_b_hash: `sha256:${"b".repeat(64)}`,
    left_candidate: "b",
    choice: "tie",
    tags: ["controls"],
    created_at: new Date().toISOString(),
  });
  assert.equal(result.success, true);
});
