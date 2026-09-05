import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LiteSeriesResultSchema,
  findRepositoryRoot,
  listTasks,
  scoreTask,
  sha256File,
  summarizeLiteBuild,
  writeEvidenceManifest,
  writeJson,
  type LiteTaskResult,
  type TestOutcome,
} from "@carrick/gamebench-core";
import { checkLiteBenchmark, loadLiteRelease } from "../src/lite-runner.js";

const timestamp = "2026-08-30T00:00:00.000Z";

async function makeTaskResult(
  runDir: string,
  task: Awaited<ReturnType<typeof listTasks>>[number],
): Promise<LiteTaskResult> {
  const taskDir = path.join(runDir, "tasks", task.manifest.id);
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, "source.tar.zst"), task.manifest.id);
  const sourceDigest = await sha256File(path.join(taskDir, "source.tar.zst"));
  const sourceHash = `sha256:${sourceDigest}` as const;
  await writeFile(path.join(taskDir, "source.sha256"), `${sourceDigest}  source.tar.zst\n`);
  const outcomes: TestOutcome[] = task.manifest.tests.map((entry) => ({
    id: entry.id,
    passed: false,
    duration_ms: 0,
    artifacts: [],
  }));
  const score = scoreTask(task.manifest, task.hash, outcomes);
  const agent = {
    invocation: 1 as const,
    started_at: timestamp,
    finished_at: timestamp,
    wall_time_ms: 0,
    exit_reason: "completed" as const,
  };
  await Promise.all([
    writeJson(path.join(taskDir, "agent.json"), agent),
    writeJson(path.join(taskDir, "tests.json"), outcomes),
    writeJson(path.join(taskDir, "score.json"), score),
  ]);
  await writeEvidenceManifest(taskDir);
  return {
    task_id: task.manifest.id,
    task_version: task.manifest.version,
    task_hash: task.hash,
    source_hash: sourceHash,
    agent,
    evaluation: { seed: 104729, status: "scored", score },
    artifact_manifest_hash: `sha256:${await sha256File(path.join(taskDir, "MANIFEST.sha256"))}` as const,
  };
}

test("Lite check binds result scores to hashed evaluator evidence", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-lite-check-"));
  const runDir = path.join(temporary, "run");
  try {
    // The existing published evidence is authored against the 0.6.0 release
    // lock; bind this check to it explicitly so it is not re-read against the
    // currently active benchmark version.
    const { releaseHash } = await loadLiteRelease(repositoryRoot, "0.6.0");
    const tasks = await listTasks(repositoryRoot);
    const rows: LiteTaskResult[] = [];
    for (const task of tasks) {
      rows.push(await makeTaskResult(runDir, task));
    }
    const result = LiteSeriesResultSchema.parse({
      schema_version: 2,
      benchmark: "carrick-ai-gamebench",
      benchmark_version: "0.6.0",
      release_hash: releaseHash,
      series_id: "01M00000000000000000000000",
      git_commit: "unknown",
      source_tree_clean: false,
      profile: "local",
      configuration: {
        agent: { id: "test", version: "1", model: "test", harness: "test", parameters: {} },
        prompt_language: "en",
      },
      started_at: timestamp,
      finished_at: timestamp,
      tasks: rows,
      build: summarizeLiteBuild(rows),
    });
    await writeJson(path.join(runDir, "result.json"), result);
    await checkLiteBenchmark(repositoryRoot, runDir);

    const firstTask = tasks[0]!;
    const changedOutcomes: TestOutcome[] = firstTask.manifest.tests.map((entry, index) => ({
      id: entry.id,
      passed: index === 0,
      duration_ms: 0,
      artifacts: [],
    }));
    const changedRows = [...rows];
    changedRows[0] = {
      ...changedRows[0]!,
      evaluation: {
        seed: 104729,
        status: "scored",
        score: scoreTask(firstTask.manifest, firstTask.hash, changedOutcomes),
      },
    };
    await writeJson(path.join(runDir, "result.json"), {
      ...result,
      tasks: changedRows,
      build: summarizeLiteBuild(changedRows),
    });
    await assert.rejects(
      checkLiteBenchmark(repositoryRoot, runDir),
      /differs from evaluator evidence/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
