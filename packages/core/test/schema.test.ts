import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskManifestSchema,
  TrackSchema,
  RunManifestV2Schema,
  VoteSchema,
} from "../src/index.js";

test("task manifests reject unknown keys", () => {
  const result = TaskManifestSchema.safeParse({
    schema_version: 1,
    unexpected: true,
  });
  assert.equal(result.success, false);
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
