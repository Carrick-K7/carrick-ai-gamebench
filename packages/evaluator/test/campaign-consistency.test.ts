import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CampaignPlanV2Schema, findRepositoryRoot, listTasks, sha256File, scoreTask,
  writeEvidenceManifest, writeJson, type CampaignPlanV2, type LiteTaskResult,
} from "@carrick/gamebench-core";
import { assembleBuildSuiteResult } from "../src/build-suite.js";
import { assertCampaignV2MayStart, campaignV2ExecutionOptions } from "../src/campaign-v2-io.js";
import { checkSuitePublishedResults, publishCampaignsV2 } from "../src/suite-publication.js";
import { loadSuiteRelease } from "../src/suite-release.js";

const timestamp = "2026-09-06T00:00:00.000Z";
function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-campaign-commits-"));
  await cp(path.join(await findRepositoryRoot(), "benchmark"), path.join(root, "benchmark"), { recursive: true });
  await writeJson(path.join(root, "package.json"), { version: "0.7.0" });
  const { releaseHash } = await loadSuiteRelease(root);
  const adapter = path.join(root, "fixture.sh");
  await writeFile(adapter, "#!/bin/sh\nexit 99 # fixture is never invoked\n");
  await chmod(adapter, 0o755);
  const plan = CampaignPlanV2Schema.parse({
    schema_version: 2, campaign_id: "commit-consistency", benchmark_version: "0.7.0", release_hash: releaseHash,
    suite: "build", protocol: "build-campaign-v1",
    comparison: { unit: "system", primary_endpoints: ["build.score"], comparability: "within-release-only", vary: ["model"], order_policy: "preregistered" },
    cells: await Promise.all([0, 1].map(async (index) => ({
      cell_id: index ? "second" : "first", series_id: `01K0000000000000000000000${index}`,
      agent: { id: "fixture", version: "1.0.0" }, adapter: { path: "fixture.sh", hash: `sha256:${await sha256File(adapter)}` },
      provider: "fixture", model: `fixture-${index}`, parameters: { thinking: "off" }, prompt_language: "en",
      isolation: { session: false, context_files: false, extensions: false, skills: false },
    }))),
  });
  await writeJson(path.join(root, "benchmark", "campaigns", "0.7.0", `${plan.campaign_id}.json`), plan);
  await writeFile(path.join(root, ".gitignore"), "runs/\nresults/\n");
  // Synthetic Git history is confined to this temporary test repository.
  git(root, ["init", "--quiet"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "synthetic preregistration"]);
  const firstCommit = git(root, ["rev-parse", "HEAD"]);
  git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "synthetic runner revision"]);
  const secondCommit = git(root, ["rev-parse", "HEAD"]);
  await writeJson(path.join(root, "results", "lite", "index.json"), { schema_version: 1, results: [] });
  return { root, plan, firstCommit, secondCommit };
}

/** Sealed, internally consistent synthetic Build evidence; no agent/build/browser runs. */
async function record(root: string, plan: CampaignPlanV2, index: number, commit: string) {
  const options = campaignV2ExecutionOptions(root, plan, plan.cells[index]!);
  const runDir = path.join(root, "runs", plan.benchmark_version, options.seriesId);
  const tasks: LiteTaskResult[] = [];
  const { release } = await loadSuiteRelease(root);
  const catalog = await listTasks(root);
  for (const reference of release.suites.build.tasks) {
    const task = catalog.find((candidate) => candidate.manifest.id === reference.id)!;
    const taskDir = path.join(runDir, "tasks", task.manifest.id);
    await mkdir(taskDir, { recursive: true });
    const archive = path.join(taskDir, "source.tar.zst");
    await writeFile(archive, "synthetic archived bytes for evidence checking only");
    const sourceHash = await sha256File(archive);
    await writeFile(path.join(taskDir, "source.sha256"), `${sourceHash}  source.tar.zst\n`);
    const agent = { invocation: 1 as const, started_at: timestamp, finished_at: timestamp, wall_time_ms: 0, exit_reason: "completed" as const };
    const outcomes = task.manifest.tests.map((entry) => ({ id: entry.id, passed: true, duration_ms: 0, artifacts: [] }));
    const score = scoreTask(task.manifest, task.hash, outcomes);
    await writeJson(path.join(taskDir, "agent.json"), agent);
    await writeJson(path.join(taskDir, "tests.json"), outcomes);
    await writeJson(path.join(taskDir, "score.json"), score);
    await writeEvidenceManifest(taskDir);
    tasks.push({ task_id: task.manifest.id, task_version: task.manifest.version, task_hash: task.hash,
      source_hash: `sha256:${sourceHash}`, agent, evaluation: { seed: 104729, status: "scored", score },
      artifact_manifest_hash: `sha256:${await sha256File(path.join(taskDir, "MANIFEST.sha256"))}` });
  }
  const result = assembleBuildSuiteResult({ benchmarkVersion: plan.benchmark_version, releaseHash: plan.release_hash,
    seriesId: options.seriesId, gitCommit: commit, sourceTreeClean: true, official: true,
    configuration: options.configuration, campaign: options.campaign, startedAt: timestamp, finishedAt: timestamp, tasks });
  await writeJson(path.join(runDir, "result.json"), result);
  await writeJson(path.join(runDir, ".series.json"), { schema_version: 2, suite: "build", status: "complete",
    benchmark_version: result.benchmark_version, release_hash: result.release_hash, series_id: result.series_id,
    started_at: timestamp, finished_at: timestamp, campaign_id: plan.campaign_id,
    cell_id: options.campaign.cell_id, plan_hash: options.campaign.plan_hash });
  return { result, runDir };
}

test("Campaign commit consistency is enforced before another cell, batch publication and public validation", async () => {
  const f = await fixture();
  try {
    const first = await record(f.root, f.plan, 0, f.firstCommit);
    await assert.rejects(assertCampaignV2MayStart(f.root, f.plan, f.plan.cells[1]!), /same recorded Git commit/);
    // Both commits contain the exact preregistered plan/release/adapter, but
    // that per-row attestation must not substitute for campaign consistency.
    const second = await record(f.root, f.plan, 1, f.secondCommit);
    await assert.rejects(publishCampaignsV2(f.root, [f.plan.campaign_id]), /same recorded Git commit/);
    assert.deepEqual(await readdir(path.join(f.root, "results", "lite")), ["index.json"]);
    second.result.git_commit = f.firstCommit;
    await writeJson(path.join(second.runDir, "result.json"), second.result);
    const published = await publishCampaignsV2(f.root, [f.plan.campaign_id]);
    assert.equal(published.length, 2);
    assert.deepEqual(await checkSuitePublishedResults(f.root), { results: 2, campaigns: 1 });
    const firstBytes = await readFile(published[0]!, "utf8");
    second.result.git_commit = f.secondCommit;
    await writeJson(published[1]!, second.result);
    await assert.rejects(checkSuitePublishedResults(f.root), /same recorded Git commit/);
    assert.equal(await readFile(published[0]!, "utf8"), firstBytes);
    assert.equal(first.result.git_commit, f.firstCommit);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
