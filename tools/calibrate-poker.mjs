import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  findRepositoryRoot,
  loadTask,
} from "../packages/core/dist/index.js";
import { sealSubmissionWorkspace } from "../packages/evaluator/dist/archive.js";
import { evaluateSubmissionArchive } from "../packages/evaluator/dist/evaluate.js";

const repositoryRoot = await findRepositoryRoot();
const task = await loadTask("build.texas-holdem.v1", repositoryRoot);
const reference = path.join(
  repositoryRoot,
  "benchmark",
  "calibration",
  "texas-holdem",
  "reference",
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-poker-calibration-"));

try {
  const archivePath = path.join(temporary, "source.tar.zst");
  const sealed = await sealSubmissionWorkspace(
    reference,
    archivePath,
    path.join(temporary, "archive.log"),
  );
  const result = await evaluateSubmissionArchive(task, {
    archivePath,
    sourceSnapshotHash: sealed.sourceSnapshotHash,
    evaluationDir: path.join(temporary, "evaluation"),
    seed: 104729,
  });
  const failures = result.outcomes.filter((outcome) => !outcome.passed);
  if (result.score.percent !== 100 || failures.length > 0) {
    throw new Error(
      `Texas Hold'em calibration failed: ${result.score.percent}; ` +
        failures.map((failure) => `${failure.id}: ${failure.message ?? "failed"}`).join("; "),
    );
  }
  console.log(`PASS  Texas Hold'em calibration: 100/100 (${task.hash})`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
