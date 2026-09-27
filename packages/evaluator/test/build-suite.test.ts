import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CampaignPlanV2Schema,
  campaignCellExecutionSpecV2Hash,
  campaignPlanV2Hash,
  createReleaseLockV4,
  findRepositoryRoot,
  listTasks,
  loadPlayTasks,
  scoreTask,
  summarizeLiteBuild,
  writeJson,
  type CampaignPlanV2,
  type FlatSeriesResultBuildV3,
  type LiteTaskResult,
  type LoadedTask,
} from "@carrick/gamebench-core";
import {
  assembleBuildSuiteResult,
  assertCampaignV2Binding,
  checkBuildSuite,
  runBuildSuite,
} from "../src/build-suite.js";
import { qualifyFlatSeriesV3 } from "@carrick/gamebench-core";
import { loadSuiteRelease } from "../src/suite-release.js";
import { runBuildTaskBatch } from "../src/build-tasks.js";

const BUILD_SUITE_TASKS = [
  "build.2048.v2",
  "build.minesweeper.v2",
  "build.parking-2d.v2",
  "build.texas-holdem.v1",
];

const RELEASE_HASH = `sha256:${"0".repeat(64)}` as const;
const TIMESTAMP = "2026-09-06T00:00:00.000Z";

function scoredTask(task: LoadedTask, percent: number): LiteTaskResult {
  const outcomes = task.manifest.tests.map((entry) => ({
    id: entry.id,
    passed: true,
    duration_ms: 0,
    artifacts: [],
  }));
  const score = scoreTask(task.manifest, task.hash, outcomes);
  const altered = { ...score, percent, earned: percent };
  return {
    task_id: task.manifest.id,
    task_version: task.manifest.version,
    task_hash: task.hash,
    source_hash: `sha256:${"a".repeat(64)}`,
    agent: {
      invocation: 1,
      started_at: TIMESTAMP,
      finished_at: TIMESTAMP,
      wall_time_ms: 0,
      exit_reason: "completed",
    },
    evaluation: { seed: 104729, status: "scored", score: altered },
    artifact_manifest_hash: `sha256:${"b".repeat(64)}`,
  };
}

async function fixture() {
  const repositoryRoot = await findRepositoryRoot();
  const allTasks = await listTasks(repositoryRoot);
  const buildTasks = allTasks.filter((task) =>
    BUILD_SUITE_TASKS.includes(task.manifest.id),
  );
  const playTasks = await loadPlayTasks(repositoryRoot);
  const release = createReleaseLockV4("0.7.0", buildTasks, playTasks);
  const tasks = buildTasks.map((task, index) => scoredTask(task, 100 - index * 10));
  const result = assembleBuildSuiteResult({
    benchmarkVersion: "0.7.0",
    releaseHash: RELEASE_HASH,
    seriesId: "01M00000000000000000000000",
    gitCommit: "a".repeat(40),
    sourceTreeClean: true,
    official: true,
    configuration: {
      agent: { id: "pi", version: "0.84.3", model: "gpt-5.6-luna", harness: "pi", parameters: {} },
      prompt_language: "en",
    },
    startedAt: TIMESTAMP,
    finishedAt: TIMESTAMP,
    tasks,
  });
  return { repositoryRoot, buildTasks, tasks, release, result };
}

test("V4 Build suite result preserves every Lite field and an equal-weight score", async () => {
  const { result, tasks } = await fixture();
  assert.equal(result.schema_version, 3);
  assert.equal(result.suite, "build");
  assert.equal(result.benchmark, "carrick-ai-gamebench");
  assert.equal(result.tasks.length, 4);
  // Full Lite provenance is retained: agent, evaluation seed/status, source_hash,
  // artifact_manifest_hash (never fabricated).
  assert.equal(result.tasks[0]!.agent.invocation, 1);
  assert.equal(result.tasks[0]!.evaluation.seed, 104729);
  assert.equal(result.tasks[0]!.evaluation.status, "scored");
  assert.match(result.tasks[0]!.source_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.tasks[0]!.artifact_manifest_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.tasks.map((row) => row.task_id).join(","), tasks.map((row) => row.task_id).join(","));
  const mean = Math.round((tasks.reduce((sum, row) => sum + row.evaluation.score!.percent, 0) / 4) * 10_000) / 10_000;
  assert.equal(result.build.score, mean);
  assert.deepEqual(result.build, summarizeLiteBuild(tasks, 4));
});

test("shared Build batch keeps one attempt per task and all failure evidence", async () => {
  const { buildTasks, tasks } = await fixture();
  for (const failure of ["none", "throw", "infrastructure"] as const) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "cagb-build-batch-"));
    const calls: string[] = [];
    try {
      const pending = runBuildTaskBatch(buildTasks, runDir, async (task) => {
        calls.push(task.manifest.id);
        const index = buildTasks.indexOf(task);
        if (index === 1 && failure === "throw") throw new Error("fixture task failed");
        if (index === 1 && failure === "infrastructure") return {
          ...tasks[index]!, evaluation: { seed: 104729, status: "infrastructure-error", message: "fixture infrastructure" },
        };
        return tasks[index]!;
      });
      if (failure === "none") {
        const result = await pending;
        assert.deepEqual(result.tasks, tasks);
        assert.deepEqual(result.build, summarizeLiteBuild(tasks));
      } else {
        await assert.rejects(pending, /benchmark could not produce a complete/);
        const evidence = JSON.parse(await readFile(path.join(runDir, "benchmark-error.json"), "utf8"));
        assert.equal(evidence.series_id, path.basename(runDir));
        assert.equal(evidence.completed_tasks.length, failure === "throw" ? 3 : 4);
        if (failure === "throw") {
          assert.deepEqual(evidence.errors, [{ task_id: buildTasks[1]!.manifest.id, message: "fixture task failed" }]);
          assert.deepEqual(JSON.parse(await readFile(path.join(runDir, "tasks", buildTasks[1]!.manifest.id, "task-error.json"), "utf8")), evidence.errors[0]);
        } else assert.match(evidence.errors[0].message, /exhausted infrastructure retries/);
      }
      assert.deepEqual(calls, buildTasks.map((task) => task.manifest.id), "each task is attempted exactly once, including after failures");
    } finally { await rm(runDir, { recursive: true, force: true }); }
  }
});

test("qualification marks a complete Build suite but requires a campaign binding for Official", async () => {
  const { release, result } = await fixture();
  const qualification = qualifyFlatSeriesV3(result, release, RELEASE_HASH);
  assert.equal(qualification.complete, true);
  assert.equal(qualification.tier, "experimental");
  assert.ok(qualification.reasons.includes("no preregistered campaign binding"));
});

test("qualification rejects a tampered seed and an inconsistent Build score", async () => {
  const { release, result } = await fixture();
  const tamperedSeed = JSON.parse(JSON.stringify(result)) as any;
  tamperedSeed.tasks[0].evaluation.seed = 7;
  assert.throws(
    () => qualifyFlatSeriesV3(tamperedSeed, release, RELEASE_HASH),
    /mismatched Build release task|seed/,
  );
  const tamperedScore = JSON.parse(JSON.stringify(result)) as any;
  tamperedScore.build.score = 42;
  assert.throws(
    () => qualifyFlatSeriesV3(tamperedScore, release, RELEASE_HASH),
    /score|complete|invalid/i,
  );
});

function officialPlan(result: ReturnType<typeof assembleBuildSuiteResult>): {
  plan: CampaignPlanV2;
  binding: NonNullable<(typeof result)["campaign"]>;
  configuration: (typeof result)["configuration"];
} {
  const cell = {
    cell_id: "suite-build-cell",
    series_id: result.series_id,
    agent: { id: "pi", version: "0.84.3" },
    adapter: { path: "tools/agents/pi-gamebench.sh", hash: `sha256:${"c".repeat(64)}` },
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    parameters: { thinking: "medium" },
    prompt_language: "en" as const,
    isolation: { session: false, context_files: false, extensions: false, skills: false } as const,
  };
  const plan = CampaignPlanV2Schema.parse({
    schema_version: 2,
    campaign_id: "suite-build",
    benchmark_version: "0.7.0",
    release_hash: RELEASE_HASH,
    suite: "build",
    protocol: "build-campaign-v1",
    comparison: {
      unit: "system",
      primary_endpoints: ["build.score"],
      comparability: "within-release-only",
      vary: [],
      order_policy: "preregistered",
    },
    cells: [cell],
  });
  const binding = {
    id: plan.campaign_id,
    cell_id: cell.cell_id,
    plan_hash: campaignPlanV2Hash(plan),
    execution_hash: campaignCellExecutionSpecV2Hash(cell, plan.suite, plan.protocol),
    suite: "build" as const,
  } as NonNullable<(typeof result)["campaign"]>;
  const configuration = {
    agent: {
      id: cell.agent.id,
      version: cell.agent.version,
      model: cell.model,
      harness: cell.agent.id,
      parameters: { ...cell.parameters, provider: cell.provider },
    },
    prompt_language: cell.prompt_language,
  };
  return { plan, binding, configuration };
}

test("a preregistered V2 campaign can qualify a complete Build suite as Official", async () => {
  const { release, result } = await fixture();
  const { plan, binding, configuration } = officialPlan(result);
  const official = { ...result, campaign: binding, configuration };
  const qualification = qualifyFlatSeriesV3(official, release, RELEASE_HASH, plan);
  assert.equal(qualification.complete, true);
  assert.equal(qualification.tier, "official");
  assert.deepEqual(qualification.reasons, []);
});

test("assertCampaignV2Binding rejects a tampered plan/execution/binding", async () => {
  const { result } = await fixture();
  const { plan, binding, configuration } = officialPlan(result);
  assert.doesNotThrow(() => assertCampaignV2Binding({
    binding,
    plan,
    benchmarkVersion: "0.7.0",
    releaseHash: RELEASE_HASH,
    seriesId: result.series_id,
    configuration,
  }));
  assert.throws(() => assertCampaignV2Binding({
    binding: { ...binding, plan_hash: `sha256:${"d".repeat(64)}` },
    plan,
    benchmarkVersion: "0.7.0",
    releaseHash: RELEASE_HASH,
    seriesId: result.series_id,
    configuration,
  }), /plan hash/);
  assert.throws(() => assertCampaignV2Binding({
    binding,
    plan,
    benchmarkVersion: "0.7.0",
    releaseHash: `sha256:${"1".repeat(64)}`,
    seriesId: result.series_id,
    configuration,
  }), /release hash/);
  // The actual execution config must match the cell; a mismatch is rejected.
  assert.throws(() => assertCampaignV2Binding({
    binding,
    plan,
    benchmarkVersion: "0.7.0",
    releaseHash: RELEASE_HASH,
    seriesId: result.series_id,
    configuration: { ...configuration, agent: { ...configuration.agent, model: "other-model" } },
  }), /configuration/);
});

test("a model-free Build suite run scores the frozen starter and verifies evidence", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "cagb-build-suite-"));
  await cp(
    path.join(await findRepositoryRoot(), "benchmark"),
    path.join(repositoryRoot, "benchmark"),
    { recursive: true },
  );
  await writeJson(path.join(repositoryRoot, "package.json"), { version: "0.7.0" });
  const release = createReleaseLockV4(
    "0.7.0",
    await listTasks(repositoryRoot),
    await loadPlayTasks(repositoryRoot),
  );
  await writeJson(path.join(repositoryRoot, "benchmark", "releases", "0.7.0.json"), release);
  const outputRoot = path.join(repositoryRoot, "runs", "0.7.0");
  try {
    // `true` is the model-free negative control: it builds nothing, so the
    // frozen starter is scored on the real task pipeline (a low/zero Build),
    // distinct from an infrastructure failure.
    const { runDir, result } = await runBuildSuite({
      repositoryRoot,
      outputRoot,
      agentCommand: "true",
      agentId: "fixture",
      agentVersion: "1",
      model: "fixture",
      modelParameters: {},
      harness: "fixture",
      language: "en",
      official: false,
    });
    assert.equal(result.suite, "build");
    assert.equal(result.tasks.length, 4);
    // Four invocations happened and produced frozen archives per task.
    for (const task of result.tasks) {
      await access(path.join(runDir, "tasks", task.task_id, "source.tar.zst"));
      await access(path.join(runDir, "tasks", task.task_id, "MANIFEST.sha256"));
      assert.equal(task.evaluation.seed, 104729);
    }
    // The canonical marker is `.series.json` (schema 2, suite build, complete).
    const marker = JSON.parse(await readFile(path.join(runDir, ".series.json"), "utf8"));
    assert.equal(marker.schema_version, 2);
    assert.equal(marker.suite, "build");
    assert.equal(marker.status, "complete");
    // checkBuildSuite verifies the marker + evidence + qualification.
    const checked = await checkBuildSuite({ repositoryRoot, runDir });
    assert.equal(checked.result.series_id, result.series_id);
    assert.equal(checked.qualification.complete, result.build.completed === 4);
    // A complete-coverage suite (starters that build but score low) is not
    // automatically a ranked failure; qualification only requires the four
    // tasks to be present and scored.
    assert.equal(checked.qualification.tier, "experimental");
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

async function makeRepo() {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "cagb-build-suite-"));
  await cp(
    path.join(await findRepositoryRoot(), "benchmark"),
    path.join(repositoryRoot, "benchmark"),
    { recursive: true },
  );
  await writeJson(path.join(repositoryRoot, "package.json"), { version: "0.7.0" });
  const release = createReleaseLockV4(
    "0.7.0",
    await listTasks(repositoryRoot),
    await loadPlayTasks(repositoryRoot),
  );
  await writeJson(path.join(repositoryRoot, "benchmark", "releases", "0.7.0.json"), release);
  return { repositoryRoot, outputRoot: path.join(repositoryRoot, "runs", "0.7.0") };
}

function makeBuildPlan(seriesId: string, releaseHash: string, { suite = "build", model = "gpt-5.6-luna" }: { suite?: "build" | "play"; model?: string } = {}) {
  const protocol = suite === "build" ? "build-campaign-v1" : "play-visual-v1";
  const endpoints = suite === "build" ? ["build.score"] : ["play.2048.mean_score", "play.minesweeper.win_rate"];
  const cell = {
    cell_id: "suite-cell",
    series_id: seriesId,
    agent: { id: "pi", version: "0.84.3" },
    adapter: { path: "tools/agents/pi-gamebench.sh", hash: `sha256:${"c".repeat(64)}` },
    provider: "openai-codex",
    model,
    parameters: { thinking: "medium" },
    prompt_language: "en" as const,
    isolation: { session: false, context_files: false, extensions: false, skills: false } as const,
  };
  const plan = CampaignPlanV2Schema.parse({
    schema_version: 2,
    campaign_id: "suite-campaign",
    benchmark_version: "0.7.0",
    release_hash: releaseHash,
    suite,
    protocol,
    comparison: {
      unit: "system",
      primary_endpoints: endpoints,
      comparability: "within-release-only",
      vary: [],
      order_policy: "preregistered",
    },
    cells: [cell],
    ...(suite === "play" ? {
      seed_commitment: {
        schema_version: 1,
        benchmark_version: "0.7.0",
        seed_bundle_hash: `sha256:${"0".repeat(64)}`,
        tasks: [
          { task_id: "play.2048.v1", episodes: 10 },
          { task_id: "play.minesweeper.v1", episodes: 10 },
        ],
      },
    } : {}),
  } as any);
  const binding = {
    id: plan.campaign_id,
    cell_id: cell.cell_id,
    plan_hash: campaignPlanV2Hash(plan),
    execution_hash: campaignCellExecutionSpecV2Hash(cell, plan.suite, plan.protocol),
    suite,
  } as NonNullable<FlatSeriesResultBuildV3["campaign"]>;
  const configuration = {
    agent: { id: cell.agent.id, version: cell.agent.version, model: cell.model, harness: cell.agent.id, parameters: { ...cell.parameters, provider: cell.provider } },
    prompt_language: cell.prompt_language,
  };
  return { plan, binding, configuration, cell };
}

test("official Build suite without a campaign is rejected before any call", async () => {
  await assert.rejects(
    runBuildSuite({
      repositoryRoot: os.tmpdir(),
      outputRoot: path.join(os.tmpdir(), "runs"),
      agentCommand: "true", agentId: "pi", agentVersion: "1", model: "gpt-5.6-luna",
      modelParameters: {}, harness: "pi", language: "en", official: true,
    }),
    /campaign binding/,
  );
});

test("a Play-suite campaign is rejected before any Build call", async () => {
  const repo = await makeRepo();
  try {
    const seriesId = "01M00000000000000000000009";
    const { releaseHash } = await loadSuiteRelease(repo.repositoryRoot, "0.7.0");
    const { plan, binding } = makeBuildPlan(seriesId, releaseHash, { suite: "play" });
    await assert.rejects(
      runBuildSuite({
        repositoryRoot: repo.repositoryRoot, outputRoot: repo.outputRoot,
        agentCommand: "true", agentId: "pi", agentVersion: "0.84.3", model: "gpt-5.6-luna",
        modelParameters: { provider: "openai-codex", thinking: "medium" }, harness: "pi", language: "en",
        official: false, campaign: binding, campaignPlan: plan,
      }),
      /Build-suite/,
    );
  } finally {
    await rm(repo.repositoryRoot, { recursive: true, force: true });
  }
});

test("an actual execution-config mismatch is rejected before any Build call", async () => {
  const repo = await makeRepo();
  try {
    const seriesId = "01M00000000000000000000009";
    const { releaseHash } = await loadSuiteRelease(repo.repositoryRoot, "0.7.0");
    const { plan, binding } = makeBuildPlan(seriesId, releaseHash);
    await assert.rejects(
      runBuildSuite({
        repositoryRoot: repo.repositoryRoot, outputRoot: repo.outputRoot,
        agentCommand: "true", agentId: "pi", agentVersion: "0.84.3", model: "DIFFERENT-model",
        modelParameters: { provider: "openai-codex", thinking: "medium" }, harness: "pi", language: "en",
        official: false, campaign: binding, campaignPlan: plan,
      }),
      /configuration/,
    );
  } finally {
    await rm(repo.repositoryRoot, { recursive: true, force: true });
  }
});

test("a mismatched preregistered adapter command is rejected before any Build call", async () => {
  const repo = await makeRepo();
  try {
    const seriesId = "01M00000000000000000000009";
    const { releaseHash } = await loadSuiteRelease(repo.repositoryRoot, "0.7.0");
    const { plan, binding } = makeBuildPlan(seriesId, releaseHash);
    // Matching model labels are not enough: the exact preregistered adapter
    // invocation (path + provider + model + thinking) must match options.agentCommand.
    await assert.rejects(
      runBuildSuite({
        repositoryRoot: repo.repositoryRoot, outputRoot: repo.outputRoot,
        agentCommand: "echo NOT-the-adapter", agentId: "pi", agentVersion: "0.84.3", model: "gpt-5.6-luna",
        modelParameters: { provider: "openai-codex", thinking: "medium" }, harness: "pi", language: "en",
        official: false, campaign: binding, campaignPlan: plan,
      }),
      /adapter invocation/,
    );
  } finally {
    await rm(repo.repositoryRoot, { recursive: true, force: true });
  }
});
