import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LITE_BENCHMARK_VERSION,
  LiteResultIndexSchema,
  LiteSeriesResultSchema,
  findRepositoryRoot,
  listTasks,
  scoreTask,
  sha256File,
  summarizeLiteBuild,
  writeEvidenceManifest,
  writeJson,
  type LiteSeriesResult,
  type LiteTaskResult,
  type TestOutcome,
} from "@carrick/gamebench-core";
import {
  checkLiteBenchmark,
  checkLitePublishedResults,
  loadLiteRelease,
} from "../src/lite-runner.js";
import { checkCampaignPublications, listCampaignPlans } from "../src/campaign.js";
import { loadSuiteRelease } from "../src/suite-release.js";

const timestamp = "2026-08-30T00:00:00.000Z";
const seed = 104729;

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
    evaluation: { seed, status: "scored", score },
    artifact_manifest_hash: `sha256:${await sha256File(path.join(taskDir, "MANIFEST.sha256"))}` as const,
  };
}

/** Build a valid on-disk run for a given benchmark version and return its result. */
async function buildRun(
  repositoryRoot: string,
  benchmarkVersion: string,
): Promise<{ runDir: string; result: LiteSeriesResult }> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-lite-run-"));
  const runDir = path.join(temporary, "run");
  const { releaseHash } = await loadLiteRelease(repositoryRoot, benchmarkVersion);
  const tasks = await listTasks(repositoryRoot);
  const rows: LiteTaskResult[] = [];
  for (const task of tasks) {
    rows.push(await makeTaskResult(runDir, task));
  }
  const result = LiteSeriesResultSchema.parse({
    schema_version: 2,
    benchmark: "carrick-ai-gamebench",
    benchmark_version: benchmarkVersion,
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
  return { runDir, result };
}

test("the versioned reader resolves active V4 without reinterpreting it as a Lite lock", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const loaded = await loadSuiteRelease(repositoryRoot);
  assert.equal(loaded.release.benchmark_version, "0.7.0");
  assert.match(loaded.releaseHash, /^sha256:[a-f0-9]{64}$/);
  await assert.rejects(loadLiteRelease(repositoryRoot));
});

test("loadLiteRelease loads an explicit version's own lock", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const old = await loadLiteRelease(repositoryRoot, "0.6.0");
  const current = await loadLiteRelease(repositoryRoot, LITE_BENCHMARK_VERSION);
  assert.equal(old.release.benchmark_version, "0.6.0");
  assert.notEqual(old.releaseHash, current.releaseHash);
});

test("loadLiteRelease rejects a lock whose version differs from the requested version", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-lite-lock-"));
  try {
    await mkdir(path.join(temporary, "benchmark", "releases"), { recursive: true });
    const template = JSON.parse(
      await readFile(path.join(repositoryRoot, "benchmark", "releases", "0.6.1.json"), "utf8"),
    ) as { benchmark_version: string };
    await writeFile(
      path.join(temporary, "benchmark", "releases", "0.6.9.json"),
      JSON.stringify({ ...template, benchmark_version: "0.6.8" }),
    );
    await assert.rejects(
      loadLiteRelease(temporary, "0.6.9"),
      /does not match requested version/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("loadLiteRelease rejects an unsafe requested benchmark version", async () => {
  const repositoryRoot = await findRepositoryRoot();
  for (const unsafe of ["../../../etc/passwd", "0.6.1/../..", "..", "0.6.1\\src"]) {
    await assert.rejects(loadLiteRelease(repositoryRoot, unsafe), /invalid benchmark version/);
  }
});

test("checkLiteBenchmark verifies the current release and 0.6.0-old evidence", async () => {
  const repositoryRoot = await findRepositoryRoot();
  for (const version of [LITE_BENCHMARK_VERSION, "0.6.0"]) {
    const { runDir, result } = await buildRun(repositoryRoot, version);
    try {
      assert.equal((await checkLiteBenchmark(repositoryRoot, runDir)).series_id, result.series_id);
    } finally {
      await rm(path.dirname(runDir), { recursive: true, force: true });
    }
  }
});

test("checkLiteBenchmark rejects a result bound to the wrong release hash", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const { runDir, result } = await buildRun(repositoryRoot, LITE_BENCHMARK_VERSION);
  try {
    const other = await loadLiteRelease(repositoryRoot, "0.6.0");
    await writeJson(path.join(runDir, "result.json"), {
      ...result,
      release_hash: other.releaseHash,
    });
    await assert.rejects(
      checkLiteBenchmark(repositoryRoot, runDir),
      /does not match its release lock/,
    );
  } finally {
    await rm(path.dirname(runDir), { recursive: true, force: true });
  }
});

test("checkLitePublishedResults validates every indexed row against its own release lock", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const index = LiteResultIndexSchema.parse(
    JSON.parse(await readFile(path.join(repositoryRoot, "results", "lite", "index.json"), "utf8")),
  );
  // Every row is validated against the release lock of the benchmark version it
  // records; the returned count must cover every entry currently in the index.
  assert.equal(await checkLitePublishedResults(repositoryRoot), index.results.length);
  assert.ok(index.results.length >= 1);
});

test("a release with no campaign plans directory reports an empty list", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-campaign-empty-"));
  try {
    await mkdir(path.join(temporary, "benchmark", "releases"), { recursive: true });
    await writeFile(
      path.join(temporary, "package.json"),
      JSON.stringify({ version: LITE_BENCHMARK_VERSION }),
    );
    await writeFile(
      path.join(temporary, "benchmark", "releases", `${LITE_BENCHMARK_VERSION}.json`),
      await readFile(
        path.join(repositoryRoot, "benchmark", "releases", `${LITE_BENCHMARK_VERSION}.json`),
      ),
    );
    // This temporary root has no benchmark/campaigns/<version> directory, so a
    // release that has not yet preregistered any plan must report an empty list
    // without requiring a Git-tracked adapter or any plan fixture.
    assert.equal((await listCampaignPlans(temporary)).length, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("historical 0.6.0 plans stay known and every current publication validates", async () => {
  const repositoryRoot = await findRepositoryRoot();
  // The original preregistered 0.6.0 campaigns must still be present as
  // historical samples; a later release may add further plans.
  const plans060 = await listCampaignPlans(repositoryRoot, "0.6.0");
  const present = new Set(plans060.map((plan) => plan.campaign_id));
  for (const campaignId of [
    "pi-system-baseline-2026-08-30",
    "glm-5-3-flash-302-2026-08-31",
    "glm-5-3-302-2026-09-01",
    "gemini-3-7-flash-302-2026-09-01",
  ]) {
    assert.ok(present.has(campaignId), `missing historical 0.6.0 campaign: ${campaignId}`);
  }
  const index = LiteResultIndexSchema.parse(
    JSON.parse(await readFile(path.join(repositoryRoot, "results", "lite", "index.json"), "utf8")),
  );
  assert.equal(await checkLitePublishedResults(repositoryRoot), index.results.length);
  // The standalone campaign check resolves every published result against its
  // own release, so it must account for at least the historical plans; it is
  // never required to be exactly the historical count (a newer release may have
  // preregistered and published more).
  assert.ok((await checkCampaignPublications(repositoryRoot)) >= plans060.length);
});

test("checkCampaignPublications rejects a result whose identity differs from the index", async () => {
  const repositoryRoot = await findRepositoryRoot();
  const published = await buildRun(repositoryRoot, "0.6.1");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-campaign-index-"));
  try {
    const result = {
      ...published.result,
      series_id: "01M00000000000000000000001",
      campaign: {
        id: "pi-system-baseline-2026-08-30",
        cell_id: "gpt-5.6-sol",
        plan_hash: `sha256:${"a".repeat(64)}`,
        execution_hash: `sha256:${"b".repeat(64)}`,
      },
    };
    const entryPath = "results/lite/0.6.1/01M00000000000000000000000.json";
    await mkdir(path.join(temporary, "results", "lite", "0.6.1"), { recursive: true });
    await writeJson(path.join(temporary, entryPath), result);
    await writeJson(path.join(temporary, "results", "lite", "index.json"), {
      schema_version: 1,
      results: [
        {
          benchmark_version: "0.6.1",
          series_id: "01M00000000000000000000000",
          path: entryPath,
        },
      ],
    });
    await assert.rejects(
      checkCampaignPublications(temporary),
      /identity does not match the index entry/,
    );
  } finally {
    await rm(path.dirname(published.runDir), { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
});
