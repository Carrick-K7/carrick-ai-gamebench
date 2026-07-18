import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskManifestSchema,
  TrackSchema,
  VoteSchema,
} from "../src/index.js";

test("task manifests reject unknown keys", () => {
  const result = TaskManifestSchema.safeParse({
    schema_version: 1,
    unexpected: true,
  });
  assert.equal(result.success, false);
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
