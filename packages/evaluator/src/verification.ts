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
  ReproductionRecordSchema,
  ScoreResultSchema,
  VerificationRecordSchema,
  loadTask,
  scoreResultIdentity,
  sha256Canonical,
  sha256File,
  verifyEvidenceManifest,
  writeEvidenceManifest,
  writeJson,
  type ReproductionRecord,
  type VerificationRecord,
} from "@carrick/gamebench-core";
import {
  exportCleanSource,
  preparePublicArtifacts,
} from "@carrick/gamebench-publisher";
import { evaluateSubmission } from "./evaluate.js";

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
    await exists(path.join(options.runDir, "public", "clean-source.tar.zst")) &&
    await exists(path.join(options.runDir, "public", "playable", "index.html"))
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
      { replacePlayable: true },
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
