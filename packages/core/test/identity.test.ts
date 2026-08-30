import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSubmissionInputFingerprint,
  canonicalJson,
  computeConfigurationId,
  computeEvaluationInputFingerprint,
  computeSubmissionInputFingerprint,
  createUlid,
  sha256Canonical,
} from "../src/index.js";

test("canonical JSON orders object keys and has a stable SHA-256", () => {
  const input = { b: 2, a: 1 };
  assert.equal(canonicalJson(input), '{"a":1,"b":2}');
  assert.equal(
    sha256Canonical(input),
    "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

test("ULIDs are valid, time-sortable identifiers", () => {
  const earlier = createUlid(1_000);
  const later = createUlid(2_000);
  assert.match(earlier, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  assert.ok(earlier < later);
  assert.notEqual(createUlid(1_000), createUlid(1_000));
});

test("v0.5 identities separate development input from evaluation seed", () => {
  const releaseHash = `sha256:${"a".repeat(64)}` as const;
  const taskHash = `sha256:${"b".repeat(64)}` as const;
  const sourceHash = `sha256:${"c".repeat(64)}` as const;
  const commandHash = `sha256:${"e".repeat(64)}` as const;
  const configurationId = computeConfigurationId({
    benchmark_version: "0.5.0",
    benchmark_release_hash: releaseHash,
    agent: {
      id: "agent",
      version: "1",
      model: "model",
      harness: "cli",
      parameters: {},
    },
    prompt_language: "en",
    execution_profile: "official-candidate",
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "3",
      git_commit: "d".repeat(40),
      source_tree_dirty: false,
    },
  });
  const configurationWithoutExplicitDefaults = computeConfigurationId({
    benchmark_version: "0.5.0",
    benchmark_release_hash: releaseHash,
    agent: {
      id: "agent",
      version: "1",
      model: "model",
      harness: "cli",
    },
    prompt_language: "en",
    execution_profile: "official-candidate",
    environment: {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "3",
      git_commit: "d".repeat(40),
      source_tree_dirty: false,
    },
  } as Parameters<typeof computeConfigurationId>[0]);
  assert.equal(configurationWithoutExplicitDefaults, configurationId);

  const developmentInput = {
    configuration_id: configurationId,
    agent_command_hash: commandHash,
    task_id: "build.sample.v1",
    task_version: "1.0.0",
    task_hash: taskHash,
    prompt_language: "en" as const,
    budget_seconds: 3600,
    network_policy: "full" as const,
    development_parameters: {
      agent_command_hash: commandHash,
    },
  };
  const development = computeSubmissionInputFingerprint(developmentInput);
  assert.doesNotThrow(() =>
    assertSubmissionInputFingerprint(developmentInput, development));
  const changedCommandHash = `sha256:${"f".repeat(64)}` as const;
  assert.throws(
    () => assertSubmissionInputFingerprint({
      ...developmentInput,
      agent_command_hash: changedCommandHash,
    }, development),
    /development_parameters agent command hash must match/,
  );
  assert.throws(
    () => assertSubmissionInputFingerprint({
      ...developmentInput,
      agent_command_hash: changedCommandHash,
      development_parameters: { agent_command_hash: changedCommandHash },
    }, development),
    /submission input fingerprint mismatch/,
  );
  assert.notEqual(
    computeSubmissionInputFingerprint({
      ...developmentInput,
      development_parameters: {
        ...developmentInput.development_parameters,
        sandbox_profile: "network-isolated",
      },
    }),
    development,
  );
  const firstEvaluation = computeEvaluationInputFingerprint({
    benchmark_release_hash: releaseHash,
    configuration_id: configurationId,
    submission_id: "01K00000000000000000000000",
    source_snapshot_hash: sourceHash,
    task_id: "build.sample.v1",
    task_version: "1.0.0",
    task_hash: taskHash,
    evaluation_seed: 104729,
  });
  const secondEvaluation = computeEvaluationInputFingerprint({
    benchmark_release_hash: releaseHash,
    configuration_id: configurationId,
    submission_id: "01K00000000000000000000000",
    source_snapshot_hash: sourceHash,
    task_id: "build.sample.v1",
    task_version: "1.0.0",
    task_hash: taskHash,
    evaluation_seed: 130363,
  });
  assert.match(development, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(firstEvaluation, secondEvaluation);
  assert.notEqual(development, firstEvaluation);
});
