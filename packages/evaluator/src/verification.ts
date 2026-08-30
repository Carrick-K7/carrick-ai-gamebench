import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RunManifestV2Schema,
  RunManifestV3Schema,
  SubmissionManifestSchema,
  ReproductionRecordSchema,
  ReproductionRecordV2Schema,
  ScoreResultSchema,
  VerificationRecordSchema,
  VerificationRecordV2Schema,
  loadTask,
  scoreResultIdentity,
  sha256Canonical,
  sha256File,
  verifyEvidenceManifest,
  writeEvidenceManifest,
  writeJson,
  type ReproductionRecord,
  type ReproductionRecordV2,
  type VerificationRecord,
  type VerificationRecordV2,
} from "@carrick/gamebench-core";
import {
  exportCleanSource,
  preparePublicArtifacts,
} from "@carrick/gamebench-publisher";
import {
  evaluateSubmission,
  evaluateSubmissionArchive,
} from "./evaluate.js";
import {
  sealSubmissionWorkspace,
  withMaterializedSubmission,
} from "./archive.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface VerifyRunOptions {
  repositoryRoot: string;
  runDir: string;
  verifierId: string;
  verifierOrganization?: string;
  evaluatorImageDigest: `sha256:${string}`;
  networkAttestation:
    | "not-required"
    | "operator-attested-model-api-only"
    | "unverified";
}

export interface PrepareReproducibleRunOptions {
  repositoryRoot: string;
  runDir: string;
  force?: boolean;
}

export async function prepareReproducibleRun(
  options: PrepareReproducibleRunOptions,
): Promise<ReproductionRecord> {
  const reproductionPath = path.join(options.runDir, "reproduction.json");
  if (
    !options.force &&
    await exists(reproductionPath) &&
    await exists(path.join(options.runDir, "public", "clean-source.tar.zst"))
  ) {
    const evidence = await verifyEvidenceManifest(options.runDir);
    if (!evidence.valid) {
      throw new Error(evidence.errors.join("\n"));
    }
    return ReproductionRecordSchema.parse(
      JSON.parse(await readFile(reproductionPath, "utf8")),
    );
  }

  const run = RunManifestV2Schema.parse(
    JSON.parse(await readFile(path.join(options.runDir, "run.json"), "utf8")),
  );
  const existingEvidence = await verifyEvidenceManifest(options.runDir);
  if (!existingEvidence.valid) {
    throw new Error(existingEvidence.errors.join("\n"));
  }
  const originalScore = ScoreResultSchema.parse(
    JSON.parse(await readFile(path.join(options.runDir, "score.json"), "utf8")),
  );
  const task = await loadTask(run.task_id, options.repositoryRoot);
  if (task.hash !== run.task_hash || task.manifest.version !== run.task_version) {
    throw new Error("run task does not match the current benchmark checkout");
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-verify-"));
  const cleanSource = path.join(temporary, "source");
  const evaluationRoot = path.join(temporary, "evaluation");
  try {
    await exportCleanSource(path.join(options.runDir, "workspace"), cleanSource);
    const reevaluation = await evaluateSubmission(task, {
      submissionDir: cleanSource,
      runDir: evaluationRoot,
      seed: run.seed,
      showcasePath: path.join(options.runDir, "public", "showcase.png"),
    });
    const originalIdentity = sha256Canonical(scoreResultIdentity(originalScore));
    const recomputedIdentity = sha256Canonical(
      scoreResultIdentity(reevaluation.score),
    );
    if (originalIdentity !== recomputedIdentity) {
      throw new Error(
        `recomputed score differs: original ${originalIdentity}, reproduced ${recomputedIdentity}`,
      );
    }

    const publicRoot = path.join(options.runDir, "public");
    const publicArtifacts = await preparePublicArtifacts(
      cleanSource,
      publicRoot,
      {
        replacePlayable: true,
        requirePlayable: !originalScore.hard_gate_failed,
      },
    );
    const cleanSourceId =
      `sha256:${await sha256File(publicArtifacts.sourceArchive)}` as const;
    const reproduction = ReproductionRecordSchema.parse({
      schema_version: 1,
      prepared_at: new Date().toISOString(),
      benchmark_release_hash: run.benchmark_release_hash,
      clean_source_artifact_id: cleanSourceId,
      recomputed_score_hash: recomputedIdentity,
    });
    await writeJson(reproductionPath, reproduction);
    await writeEvidenceManifest(options.runDir);
    return reproduction;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyAndReproduceRun(
  options: VerifyRunOptions,
): Promise<VerificationRecord> {
  const run = RunManifestV2Schema.parse(
    JSON.parse(await readFile(path.join(options.runDir, "run.json"), "utf8")),
  );
  const reproduction = await prepareReproducibleRun({
    repositoryRoot: options.repositoryRoot,
    runDir: options.runDir,
    force: true,
  });
  const evidenceManifestHash =
    `sha256:${await sha256File(path.join(options.runDir, "MANIFEST.sha256"))}` as const;
  const verification = VerificationRecordSchema.parse({
    schema_version: 1,
    status: "operator-reproduced",
    verifier: {
      id: options.verifierId,
      ...(options.verifierOrganization
        ? { organization: options.verifierOrganization }
        : {}),
    },
    verified_at: new Date().toISOString(),
    benchmark_release_hash: run.benchmark_release_hash,
    git_commit: run.environment.git_commit,
    evaluator_image_digest: options.evaluatorImageDigest,
    network_attestation: options.networkAttestation,
    evidence_manifest_hash: evidenceManifestHash,
    clean_source_artifact_id: reproduction.clean_source_artifact_id,
    recomputed_score_hash: reproduction.recomputed_score_hash,
  });
  await writeJson(path.join(options.runDir, "verification.json"), verification);
  return verification;
}

export interface PrepareReproducibleSubmissionOptions {
  repositoryRoot: string;
  submissionDir: string;
  evaluationDirs: string[];
  force?: boolean;
}

function evaluationSetIdentity(
  evaluations: Array<{ evaluation_seed: number; score_hash: `sha256:${string}` }>,
): `sha256:${string}` {
  return sha256Canonical(
    evaluations
      .slice()
      .sort((left, right) => left.evaluation_seed - right.evaluation_seed),
  );
}

export async function prepareReproducibleSubmission(
  options: PrepareReproducibleSubmissionOptions,
): Promise<ReproductionRecordV2> {
  const reproductionPath = path.join(options.submissionDir, "reproduction.json");
  if (
    !options.force &&
    await exists(reproductionPath) &&
    await exists(path.join(options.submissionDir, "public", "clean-source.tar.zst"))
  ) {
    const evidence = await verifyEvidenceManifest(options.submissionDir);
    if (!evidence.valid) {
      throw new Error(evidence.errors.join("\n"));
    }
    return ReproductionRecordV2Schema.parse(
      JSON.parse(await readFile(reproductionPath, "utf8")),
    );
  }

  const submission = SubmissionManifestSchema.parse(
    JSON.parse(
      await readFile(path.join(options.submissionDir, "submission.json"), "utf8"),
    ),
  );
  const existingEvidence = await verifyEvidenceManifest(options.submissionDir);
  if (!existingEvidence.valid) {
    throw new Error(existingEvidence.errors.join("\n"));
  }
  const task = await loadTask(submission.task_id, options.repositoryRoot);
  if (
    task.hash !== submission.task_hash ||
    task.manifest.version !== submission.task_version
  ) {
    throw new Error("submission task does not match the current benchmark checkout");
  }

  if (options.evaluationDirs.length === 0) {
    throw new Error("submission reproduction requires at least one evaluation");
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-verify-submission-"));
  const cleanSource = path.join(temporary, "clean-source");
  const cleanArchive = path.join(temporary, "clean-source.tar.zst");
  try {
    await withMaterializedSubmission(
      path.join(options.submissionDir, "source.tar.zst"),
      submission.source_snapshot_hash as `sha256:${string}`,
      path.join(temporary, "source-materialize.log"),
      async (materialized) => {
        await exportCleanSource(materialized, cleanSource);
      },
    );
    const sealedClean = await sealSubmissionWorkspace(
      cleanSource,
      cleanArchive,
      path.join(temporary, "clean-archive.log"),
    );

    const identities: Array<{
      evaluation_seed: number;
      score_hash: `sha256:${string}`;
    }> = [];
    for (const evaluationDir of options.evaluationDirs) {
      const run = RunManifestV3Schema.parse(
        JSON.parse(await readFile(path.join(evaluationDir, "run.json"), "utf8")),
      );
      if (
        run.submission_id !== submission.submission_id ||
        run.task_id !== submission.task_id ||
        run.task_hash !== submission.task_hash
      ) {
        throw new Error(`evaluation does not belong to submission: ${run.run_id}`);
      }
      const originalScore = ScoreResultSchema.parse(
        JSON.parse(await readFile(path.join(evaluationDir, "score.json"), "utf8")),
      );
      const reevaluationRoot = path.join(temporary, "evaluations", run.run_id);
      const reevaluation = await evaluateSubmissionArchive(task, {
        archivePath: cleanArchive,
        sourceSnapshotHash: sealedClean.sourceSnapshotHash,
        evaluationDir: reevaluationRoot,
        seed: run.evaluation_seed,
        showcasePath: path.join(evaluationDir, "public", "showcase.png"),
      });
      const originalIdentity = sha256Canonical(scoreResultIdentity(originalScore));
      const recomputedIdentity = sha256Canonical(
        scoreResultIdentity(reevaluation.score),
      );
      if (originalIdentity !== recomputedIdentity) {
        throw new Error(
          `recomputed score differs for seed ${run.evaluation_seed}: original ${originalIdentity}, reproduced ${recomputedIdentity}`,
        );
      }
      identities.push({
        evaluation_seed: run.evaluation_seed,
        score_hash: recomputedIdentity,
      });
      await writeEvidenceManifest(evaluationDir);
    }

    const publicRoot = path.join(options.submissionDir, "public");
    const firstScore = ScoreResultSchema.parse(
      JSON.parse(
        await readFile(path.join(options.evaluationDirs[0] ?? "", "score.json"), "utf8"),
      ),
    );
    const publicArtifacts = await preparePublicArtifacts(
      cleanSource,
      publicRoot,
      {
        replacePlayable: true,
        requirePlayable: !firstScore.hard_gate_failed,
      },
    );
    const cleanSourceId =
      `sha256:${await sha256File(publicArtifacts.sourceArchive)}` as const;
    const reproduction = ReproductionRecordV2Schema.parse({
      schema_version: 2,
      prepared_at: new Date().toISOString(),
      benchmark_release_hash: submission.benchmark_release_hash,
      submission_id: submission.submission_id,
      clean_source_artifact_id: cleanSourceId,
      evaluation_set_hash: evaluationSetIdentity(identities),
    });
    await writeJson(reproductionPath, reproduction);
    await writeEvidenceManifest(options.submissionDir);
    return reproduction;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export interface VerifySubmissionOptions
  extends PrepareReproducibleSubmissionOptions {
  verifierId: string;
  verifierOrganization?: string;
  evaluatorImageDigest: `sha256:${string}`;
  networkAttestation:
    | "not-required"
    | "operator-attested-model-api-only"
    | "unverified";
}

export async function verifyAndReproduceSubmission(
  options: VerifySubmissionOptions,
): Promise<VerificationRecordV2> {
  const submission = SubmissionManifestSchema.parse(
    JSON.parse(
      await readFile(path.join(options.submissionDir, "submission.json"), "utf8"),
    ),
  );
  const reproduction = await prepareReproducibleSubmission({
    repositoryRoot: options.repositoryRoot,
    submissionDir: options.submissionDir,
    evaluationDirs: options.evaluationDirs,
    force: true,
  });
  const evidenceManifestHash =
    `sha256:${await sha256File(path.join(options.submissionDir, "MANIFEST.sha256"))}` as const;
  const verification = VerificationRecordV2Schema.parse({
    schema_version: 2,
    status: "operator-reproduced",
    verifier: {
      id: options.verifierId,
      ...(options.verifierOrganization
        ? { organization: options.verifierOrganization }
        : {}),
    },
    verified_at: new Date().toISOString(),
    benchmark_release_hash: submission.benchmark_release_hash,
    git_commit: submission.environment.git_commit,
    evaluator_image_digest: options.evaluatorImageDigest,
    network_attestation: options.networkAttestation,
    evidence_manifest_hash: evidenceManifestHash,
    submission_id: submission.submission_id,
    clean_source_artifact_id: reproduction.clean_source_artifact_id,
    evaluation_set_hash: reproduction.evaluation_set_hash,
  });
  await writeJson(
    path.join(options.submissionDir, "verification.json"),
    verification,
  );
  return verification;
}
