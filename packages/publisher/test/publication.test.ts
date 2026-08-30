import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PublicationManifestSchema,
  ReleaseLockV2Schema,
  computeConfigurationId,
  computeEvaluationInputFingerprint,
  computeSubmissionInputFingerprint,
  findRepositoryRoot,
  loadTask,
  scoreResultIdentity,
  scoreTask,
  sha256Buffer,
  sha256Canonical,
  sha256File,
  writeEvidenceManifest,
  writeJson,
  type PublicationManifest,
} from "@carrick/gamebench-core";
import {
  assertOfficialEligibility,
  computePublicationId,
  FilesystemArtifactStore,
  verifyPublicationIdentity,
  verifyResultsRepository,
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

test("official eligibility requires a deterministic showcase", () => {
  const payload = publicationPayload();
  const seeds = [104729, 130363, 155921];
  const runs = seeds.map((seed, index) => ({
    ...payload.runs[0]!,
    run_id: `01K0000000000000000000000${index + 1}`,
    input_fingerprint: hash(String(index + 3)),
    seed,
    artifacts: [
      ...payload.runs[0]!.artifacts,
      {
        artifact_id: hash("6"),
        role: "playable" as const,
        file_name: "index.html",
        size_bytes: 1,
        media_type: "text/html",
        url: "/play",
      },
    ],
  }));
  const publication = PublicationManifestSchema.parse({
    ...payload,
    runs,
    publication_id: computePublicationId({ ...payload, runs }),
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
      seeds,
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
    /has no deterministic showcase/,
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

async function nonEmptyFixture(root: string) {
  const objectsRoot = path.join(root, "objects");
  const resultsRoot = path.join(root, "results");
  const store = new FilesystemArtifactStore(objectsRoot, "/");
  const sourcePath = path.join(root, "clean-source.tar.zst");
  await writeFile(sourcePath, "clean public source", "utf8");
  const artifact = await store.put(sourcePath, {
    role: "clean-source",
    fileName: "clean-source.tar.zst",
    mediaType: "application/zstd",
  });
  const base = publicationPayload();
  const run = base.runs[0];
  assert.ok(run?.score);
  const scoreHash = sha256Canonical(scoreResultIdentity(run.score));
  const payload: Omit<PublicationManifest, "publication_id"> = {
    ...base,
    tier: "experimental",
    runs: [{
      ...run,
      artifacts: [artifact],
      reproduction: {
        ...run.reproduction!,
        clean_source_artifact_id: artifact.artifact_id,
        recomputed_score_hash: scoreHash,
      },
      verification: undefined,
    }].map(({ verification: _verification, ...publishedRun }) => publishedRun),
  };
  const publication = PublicationManifestSchema.parse({
    ...payload,
    publication_id: computePublicationId(payload),
  });
  await mkdir(path.join(resultsRoot, "publications"), { recursive: true });
  await writeJson(
    path.join(
      resultsRoot,
      "publications",
      `${publication.publication_id.slice("sha256:".length)}.json`,
    ),
    publication,
  );
  await writeJson(path.join(resultsRoot, "index.json"), {
    schema_version: 1,
    generated_at: "2026-07-19T00:00:00.000Z",
    benchmark_versions: ["0.2.0"],
    entries: [{
      publication_id: publication.publication_id,
      created_at: publication.created_at,
      tier: publication.tier,
      status: "active",
      benchmark_version: publication.benchmark.version,
      series_id: publication.series_id,
      configuration_id: publication.configuration.configuration_id,
      agent: publication.configuration.agent,
      aggregate: publication.aggregate,
    }],
  });
  return {
    artifact,
    artifactPath: path.join(
      objectsRoot,
      "objects",
      "sha256",
      artifact.artifact_id.slice(7, 9),
      artifact.artifact_id.slice(7),
      artifact.file_name,
    ),
    resultsRoot,
    store,
  };
}

test("a non-empty publication fixture detects missing and tampered objects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-publication-"));
  try {
    const fixture = await nonEmptyFixture(root);
    assert.deepEqual(
      await verifyResultsRepository(fixture.resultsRoot, fixture.store),
      { publications: 1, artifacts: 1 },
    );

    await writeFile(fixture.artifactPath, "tampered", "utf8");
    await assert.rejects(
      verifyResultsRepository(fixture.resultsRoot, fixture.store),
      /missing published artifact/,
    );

    await writeFile(fixture.artifactPath, "clean public source", "utf8");
    await rm(fixture.artifactPath);
    await assert.rejects(
      verifyResultsRepository(fixture.resultsRoot, fixture.store),
      /missing published artifact/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("series v2 publishes submissions and seed evaluations with aggregate v3", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-publication-v2-"));
  try {
    const task = await loadTask("build.2048.v2", repositoryRoot);
    const releasePath = path.join(repositoryRoot, "benchmark", "releases", "0.5.0.json");
    const releaseHash = `sha256:${await sha256File(releasePath)}` as const;
    const seriesId = "01K50000000000000000000000";
    const submissionId = "01K50000000000000000000001";
    const runId = "01K50000000000000000000002";
    const environment = {
      platform: "linux",
      architecture: "x64",
      node: "v22.12.0",
      runner_protocol: "3" as const,
      git_commit: "e".repeat(40),
      source_tree_dirty: false,
      evaluator_image_digest: hash("f") as `sha256:${string}`,
    };
    const agent = {
      id: "agent",
      version: "1",
      model: "model",
      harness: "shell",
      parameters: {},
    };
    const configurationId = computeConfigurationId({
      benchmark_version: "0.5.0",
      benchmark_release_hash: releaseHash,
      agent,
      prompt_language: "en",
      execution_profile: "local",
      environment,
    });
    const commandHash = sha256Buffer(Buffer.from("agent-command", "utf8"));
    const developmentParameters = { agent_command_hash: commandHash };
    const developmentFingerprint = computeSubmissionInputFingerprint({
      configuration_id: configurationId,
      agent_command_hash: commandHash,
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash as `sha256:${string}`,
      prompt_language: "en",
      budget_seconds: task.manifest.budget_seconds,
      network_policy: task.manifest.network_policy,
      development_parameters: developmentParameters,
    });
    const seriesDir = path.join(root, "series");
    const submissionDir = path.join(seriesDir, "submissions", submissionId);
    const evaluationDir = path.join(seriesDir, "evaluations", runId);
    await mkdir(path.join(submissionDir, "public", "playable"), { recursive: true });
    await mkdir(path.join(evaluationDir, "public"), { recursive: true });
    const sourceBytes = "sealed source";
    await writeFile(path.join(submissionDir, "source.tar.zst"), sourceBytes, "utf8");
    await writeFile(
      path.join(submissionDir, "source.sha256"),
      `${sha256Buffer(Buffer.from(sourceBytes)).slice(7)}  source.tar.zst\n`,
      "utf8",
    );
    await writeFile(
      path.join(submissionDir, "trajectory.jsonl"),
      `${JSON.stringify({ type: "shell-command", command_hash: commandHash })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(submissionDir, "public", "clean-source.tar.zst"),
      sourceBytes,
      "utf8",
    );
    await writeFile(
      path.join(submissionDir, "public", "playable", "index.html"),
      "<html></html>",
      "utf8",
    );
    const sourceSnapshotHash = sha256Buffer(Buffer.from(sourceBytes));
    await writeJson(path.join(submissionDir, "submission.json"), {
      schema_version: 1,
      benchmark_version: "0.5.0",
      benchmark_release_hash: releaseHash,
      series_id: seriesId,
      submission_id: submissionId,
      configuration_id: configurationId,
      development_input_fingerprint: developmentFingerprint,
      agent_command_hash: commandHash,
      development_parameters: developmentParameters,
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash,
      agent_invocation_index: 1,
      execution_profile: "local",
      prompt_language: "en",
      network_policy: task.manifest.network_policy,
      agent,
      environment,
      started_at: "2026-08-12T00:00:00.000Z",
      finished_at: "2026-08-12T00:01:00.000Z",
      development_exit_reason: "completed",
      source_snapshot_hash: sourceSnapshotHash,
      usage: { source: "not-reported" },
    });
    const score = scoreTask(
      task.manifest,
      task.hash,
      task.manifest.tests.map((definition) => ({
        id: definition.id,
        passed: true,
        duration_ms: 1,
        artifacts: [],
      })),
    );
    const evaluationFingerprint = computeEvaluationInputFingerprint({
      benchmark_release_hash: releaseHash,
      configuration_id: configurationId,
      submission_id: submissionId,
      source_snapshot_hash: sourceSnapshotHash,
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash as `sha256:${string}`,
      evaluation_seed: 104729,
      evaluator_image_digest: environment.evaluator_image_digest,
    });
    await writeJson(path.join(evaluationDir, "run.json"), {
      schema_version: 3,
      benchmark_version: "0.5.0",
      benchmark_release_hash: releaseHash,
      series_id: seriesId,
      run_id: runId,
      submission_id: submissionId,
      configuration_id: configurationId,
      input_fingerprint: evaluationFingerprint,
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash,
      evaluation_seed: 104729,
      environment,
      started_at: "2026-08-12T00:02:00.000Z",
      finished_at: "2026-08-12T00:03:00.000Z",
      exit_reason: "completed",
      wall_time_ms: 60000,
    });
    await writeJson(path.join(evaluationDir, "score.json"), score);
    await writeJson(path.join(evaluationDir, "evaluation-result.json"), {
      schema_version: 1,
      run_id: runId,
      submission_id: submissionId,
      evaluation_seed: 104729,
      score,
    });
    await writeFile(path.join(evaluationDir, "public", "showcase.png"), "png", "utf8");
    await writeEvidenceManifest(evaluationDir);
    const evaluationSetHash = sha256Canonical([{
      evaluation_seed: 104729,
      score_hash: sha256Canonical(scoreResultIdentity(score)),
    }]);
    await writeJson(path.join(submissionDir, "reproduction.json"), {
      schema_version: 2,
      prepared_at: "2026-08-12T00:04:00.000Z",
      benchmark_release_hash: releaseHash,
      submission_id: submissionId,
      clean_source_artifact_id: sourceSnapshotHash,
      evaluation_set_hash: evaluationSetHash,
    });
    await writeEvidenceManifest(submissionDir);
    await writeJson(path.join(seriesDir, "series.json"), {
      schema_version: 2,
      series_id: seriesId,
      benchmark_version: "0.5.0",
      benchmark_release_hash: releaseHash,
      git_commit: environment.git_commit,
      configuration_id: configurationId,
      configuration: {
        agent,
        prompt_language: "en",
        execution_profile: "local",
        environment,
      },
      created_at: "2026-08-12T00:00:00.000Z",
      submissions: [{
        submission_id: submissionId,
        task_id: task.manifest.id,
        task_hash: task.hash,
        agent_invocation_index: 1,
        included: true,
      }],
      evaluations: [{
        run_id: runId,
        submission_id: submissionId,
        task_id: task.manifest.id,
        task_hash: task.hash,
        evaluation_seed: 104729,
        included: true,
      }],
    });
    const resultsRoot = path.join(root, "results");
    await cp(path.join(repositoryRoot, "results"), resultsRoot, { recursive: true });
    const store = new FilesystemArtifactStore(path.join(root, "objects"), "/");
    const { publishSeries } = await import("../src/index.js");
    const publication = await publishSeries({
      repositoryRoot,
      seriesDir,
      resultsRoot,
      tier: "experimental",
      store,
    });
    assert.equal(publication.schema_version, 2);
    if (publication.schema_version !== 2) throw new Error("expected publication v2");
    assert.equal(publication.submissions.length, 1);
    assert.equal(publication.submissions[0]?.evaluations.length, 1);
    assert.equal(publication.aggregate.schema_version, 3);
    assert.deepEqual(
      await verifyResultsRepository(resultsRoot, undefined, repositoryRoot),
      { publications: 6, artifacts: 152 },
    );

    const tamperedPayload = {
      ...publication,
      submissions: publication.submissions.map((submission, index) =>
        index === 0
          ? {
              ...submission,
              evaluations: submission.evaluations.map((evaluation, evaluationIndex) =>
                evaluationIndex === 0
                  ? { ...evaluation, input_fingerprint: hash("9") }
                  : evaluation),
            }
          : submission),
    };
    const { publication_id: _oldId, ...tamperedWithoutId } = tamperedPayload;
    const tamperedId = computePublicationId(tamperedWithoutId);
    const oldPublicationPath = path.join(
      resultsRoot,
      "publications",
      `${publication.publication_id.slice(7)}.json`,
    );
    const newPublicationPath = path.join(
      resultsRoot,
      "publications",
      `${tamperedId.slice(7)}.json`,
    );
    await writeJson(newPublicationPath, {
      ...tamperedWithoutId,
      publication_id: tamperedId,
    });
    await rm(oldPublicationPath);
    const index = JSON.parse(
      await readFile(path.join(resultsRoot, "index.json"), "utf8"),
    ) as { entries: Array<{ publication_id: string }> };
    index.entries[0]!.publication_id = tamperedId;
    await writeJson(path.join(resultsRoot, "index.json"), index);
    await assert.rejects(
      verifyResultsRepository(resultsRoot, undefined, repositoryRoot),
      /evaluation input fingerprint mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the five v0.3 publications remain semantically verifiable", async () => {
  const repositoryRoot = await findRepositoryRoot();
  assert.deepEqual(
    await verifyResultsRepository(
      path.join(repositoryRoot, "results"),
      undefined,
      repositoryRoot,
    ),
    { publications: 5, artifacts: 148 },
  );
});

test("publication verification rejects a cross-release hash mismatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-release-mismatch-"));
  try {
    const fixture = await nonEmptyFixture(root);
    const releaseRoot = path.join(root, "benchmark", "releases");
    await mkdir(releaseRoot, { recursive: true });
    await writeJson(path.join(releaseRoot, "0.2.0.json"), {
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
    await assert.rejects(
      verifyResultsRepository(fixture.resultsRoot, fixture.store, root),
      /publication release hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
