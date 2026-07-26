import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicationManifestSchema,
  ReleaseLockV2Schema,
  type PublicationManifest,
} from "@carrick/gamebench-core";
import {
  assertOfficialEligibility,
  computePublicationId,
  verifyPublicationIdentity,
} from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function publicationPayload(): Omit<PublicationManifest, "publication_id"> {
  const score = {
    schema_version: 1 as const,
    task_id: "build.sample.v1",
    task_hash: hash("a"),
    earned: 100,
    available: 100,
    percent: 100,
    hard_gate_failed: false,
    categories: { build: { earned: 100, available: 100 } },
    tests: [{
      id: "build",
      category: "build" as const,
      points: 100,
      passed: true,
      duration_ms: 1,
      artifacts: [],
    }],
  };
  const reproduction = {
    schema_version: 1 as const,
    prepared_at: "2026-07-19T00:00:00.000Z",
    benchmark_release_hash: hash("b"),
    clean_source_artifact_id: hash("c"),
    recomputed_score_hash: hash("d"),
  };
  const verification = {
    schema_version: 1 as const,
    status: "operator-reproduced" as const,
    verifier: { id: "operator" },
    verified_at: "2026-07-19T00:00:00.000Z",
    benchmark_release_hash: hash("b"),
    git_commit: "e".repeat(40),
    evaluator_image_digest: hash("f"),
    network_attestation: "not-required" as const,
    evidence_manifest_hash: hash("1"),
    clean_source_artifact_id: hash("c"),
    recomputed_score_hash: hash("d"),
  };
  return {
    schema_version: 1,
    created_at: "2026-07-19T00:00:00.000Z",
    tier: "official",
    series_id: "01K00000000000000000000000",
    benchmark: {
      version: "0.2.0",
      release_hash: hash("b"),
      git_commit: "e".repeat(40),
    },
    configuration: {
      configuration_id: hash("2"),
      agent: {
        id: "agent",
        version: "1",
        model: "model",
        harness: "shell",
        parameters: {},
      },
      prompt_language: "en",
      execution_profile: "official-candidate",
      environment: {
        platform: "linux",
        architecture: "x64",
        node: "v22.12.0",
        runner_protocol: "2",
        git_commit: "e".repeat(40),
        source_tree_dirty: false,
      },
    },
    aggregate: {
      schema_version: 1,
      tasks: [{
        task_id: "build.sample.v1",
        track: "build",
        attempts: 1,
        mean: 100,
        standard_deviation: 0,
      }],
      coverage: {
        build: { completed: 1, required: 1 },
        reproduce: { completed: 0, required: 0 },
        core: { completed: 1, required: 1 },
      },
      leaderboards: { build: 100, core: 100 },
    },
    runs: [{
      run_id: "01K00000000000000000000001",
      input_fingerprint: hash("3"),
      task_id: "build.sample.v1",
      task_version: "1.0.0",
      task_hash: hash("a"),
      seed: 104729,
      attempt: 1,
      included: true,
      network_policy: "full",
      exit_reason: "completed",
      score,
      artifacts: [{
        artifact_id: hash("c"),
        role: "clean-source",
        file_name: "clean-source.tar.zst",
        size_bytes: 1,
        media_type: "application/zstd",
        url: "/source",
      }],
      reproduction,
      verification,
    }],
    review_summaries: [],
  };
}

test("publication identity detects tampering", () => {
  const payload = publicationPayload();
  const publication = PublicationManifestSchema.parse({
    ...payload,
    publication_id: computePublicationId(payload),
  });
  assert.equal(verifyPublicationIdentity(publication).publication_id, publication.publication_id);
  assert.throws(
    () => verifyPublicationIdentity({
      ...publication,
      aggregate: {
        ...publication.aggregate,
        leaderboards: { ...publication.aggregate.leaderboards, core: 99 },
      },
    }),
    /publication ID mismatch/,
  );
});

test("official eligibility rejects an incomplete fixed-seed matrix", () => {
  const payload = publicationPayload();
  const publication = PublicationManifestSchema.parse({
    ...payload,
    publication_id: computePublicationId(payload),
  });
  const lock = ReleaseLockV2Schema.parse({
    schema_version: 2,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: "0.2.0",
    protocols: {
      task_manifest: 1,
      bridge: 1,
      run_manifest: 2,
      publication_manifest: 1,
    },
    scoring: { score_result: 1, aggregate: 1 },
    official: {
      attempts_per_task: 3,
      seeds: [104729, 130363, 155921],
    },
    tracks: ["build", "reproduce"],
    task_count: 1,
    tasks: [{
      id: "build.sample.v1",
      version: "1.0.0",
      track: "build",
      hash: hash("a"),
    }],
  });
  assert.throws(
    () => assertOfficialEligibility(publication, lock, false),
    /exactly one included run/,
  );
});

test("official eligibility rejects agent and evaluation errors", () => {
  const payload = publicationPayload();
  const publication = PublicationManifestSchema.parse({
    ...payload,
    runs: payload.runs.map((run) => ({
      ...run,
      exit_reason: "agent-error" as const,
    })),
    publication_id: computePublicationId({
      ...payload,
      runs: payload.runs.map((run) => ({
        ...run,
        exit_reason: "agent-error" as const,
      })),
    }),
  });
  const lock = ReleaseLockV2Schema.parse({
    schema_version: 2,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: "0.2.0",
    protocols: {
      task_manifest: 1,
      bridge: 1,
      run_manifest: 2,
      publication_manifest: 1,
    },
    scoring: { score_result: 1, aggregate: 1 },
    official: {
      attempts_per_task: 3,
      seeds: [104729, 130363, 155921],
    },
    tracks: ["build", "reproduce"],
    task_count: 1,
    tasks: [{
      id: "build.sample.v1",
      version: "1.0.0",
      track: "build",
      hash: hash("a"),
    }],
  });
  assert.throws(
    () => assertOfficialEligibility(publication, lock, false),
    /invalid exit reason agent-error/,
  );
});

test("publication schema rejects duplicate run IDs", () => {
  const payload = publicationPayload();
  assert.equal(
    PublicationManifestSchema.safeParse({
      ...payload,
      publication_id: hash("9"),
      runs: [...payload.runs, payload.runs[0]],
    }).success,
    false,
  );
});
