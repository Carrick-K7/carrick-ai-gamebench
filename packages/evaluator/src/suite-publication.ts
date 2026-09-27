import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LiteResultIndexSchema, assertCampaignCommitConsistency, readFlatSeriesResult, qualifyFlatSeriesV3, loadTask, scoreTask, canonicalJson, type JsonValue,
  type CampaignPlanV2, type FlatSeriesResultV3,
} from "@carrick/gamebench-core";
import { listCampaignsV2, loadCampaignV2 } from "./campaign-v2-io.js";
import { assertSecretFreeSuiteConfiguration } from "./suite-configuration.js";
import { loadSuiteRelease, requireOfficialSource } from "./suite-release.js";
import { checkSuiteRun } from "./suite-runs.js";
import { publishCheckedResults } from "./publication.js";

async function json(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")); }

/** Local, complete non-campaign measurements are explicitly Experimental. */
export async function publishSuiteRun(repositoryRoot: string, runDir: string): Promise<string> {
  const { result } = await checkSuiteRun({ repositoryRoot, runDir, requireComplete: true, replayMode: "browser" });
  if (result.campaign) throw new Error("campaign-affiliated results must publish as one complete campaign batch");
  assertSecretFreeSuiteConfiguration(result);
  return (await publishCheckedResults(repositoryRoot, [result]))[0]!;
}

export async function publishCampaignsV2(repositoryRoot: string, campaignIds: string[], version?: string): Promise<string[]> {
  if (campaignIds.length === 0 || new Set(campaignIds).size !== campaignIds.length) throw new Error("provide unique campaign ids");
  requireOfficialSource(repositoryRoot);
  const results: FlatSeriesResultV3[] = [];
  for (const campaignId of campaignIds) {
    const { plan } = await loadCampaignV2(repositoryRoot, campaignId, version, { forExecution: false });
    const members: FlatSeriesResultV3[] = [];
    for (const cell of plan.cells) {
      const runDir = path.join(repositoryRoot, "runs", plan.benchmark_version, cell.series_id);
      const checked = await checkSuiteRun({ repositoryRoot, runDir, campaignPlan: plan, requireComplete: true, replayMode: "browser" });
      if (checked.qualification.tier !== "official" || checked.result.campaign?.cell_id !== cell.cell_id || checked.result.series_id !== cell.series_id) throw new Error("campaign publication requires every exact Official cell");
      assertSecretFreeSuiteConfiguration(checked.result);
      members.push(checked.result);
    }
    assertCampaignCommitConsistency(members);
    results.push(...members);
  }
  // No public path, seed reveal or index entry is touched before ALL cells pass.
  requireOfficialSource(repositoryRoot);
  return publishCheckedResults(repositoryRoot, results);
}

/** Public/portable verification: metadata, exact release/campaign bindings and metrics.
 * It deliberately does not require private run directories, provider credentials,
 * the current adapter executable, or an ancestor Git object in a shallow clone.
 */
export async function checkSuitePublishedResults(repositoryRoot: string): Promise<{ results: number; campaigns: number }> {
  const index = LiteResultIndexSchema.parse(await json(path.join(repositoryRoot, "results", "lite", "index.json")));
  const collected: FlatSeriesResultV3[] = [];
  const versions = new Set<string>();
  for (const entry of index.results) {
    const result = readFlatSeriesResult(await json(path.join(repositoryRoot, entry.path)));
    if (result.series_id !== entry.series_id || result.benchmark_version !== entry.benchmark_version) throw new Error("flat result identity differs from its canonical index entry");
    if (result.schema_version !== 3) continue;
    const { release, releaseHash } = await loadSuiteRelease(repositoryRoot, result.benchmark_version);
    const plan = result.campaign ? (await loadCampaignV2(repositoryRoot, result.campaign.id, result.benchmark_version, { forExecution: false })).plan : undefined;
    const qualification = qualifyFlatSeriesV3(result, release, releaseHash, plan);
    if (!qualification.complete) throw new Error("public index contains an incomplete suite measurement");
    if (result.suite === "build") for (const row of result.tasks) {
      const task = await loadTask(row.task_id, repositoryRoot);
      if (task.hash !== row.task_hash || !row.evaluation.score) throw new Error("published Build task differs from its reference");
      const outcomes = row.evaluation.score.tests.map((test) => ({ id: test.id, passed: test.passed, duration_ms: test.duration_ms, ...(test.message ? { message: test.message } : {}), artifacts: test.artifacts }));
      if (canonicalJson(JSON.parse(JSON.stringify(scoreTask(task.manifest, task.hash, outcomes))) as JsonValue) !== canonicalJson(JSON.parse(JSON.stringify(row.evaluation.score)) as JsonValue)) throw new Error("published Build score arithmetic was modified");
    }
    assertSecretFreeSuiteConfiguration(result);
    collected.push(result);
    versions.add(result.benchmark_version);
  }
  // Validate the active V4 plans even when there are no measured results yet.
  const active = await loadSuiteRelease(repositoryRoot);
  versions.add(active.release.benchmark_version);
  const plans = new Map<string, CampaignPlanV2>();
  for (const version of versions) for (const plan of await listCampaignsV2(repositoryRoot, version, { forExecution: false })) plans.set(`${version}/${plan.campaign_id}`, plan);
  for (const [key, plan] of plans) {
    const members = collected.filter((result) => result.campaign && `${result.benchmark_version}/${result.campaign.id}` === key);
    if (members.length > 0 && (members.length !== plan.cells.length || plan.cells.some((cell) => !members.some((result) => result.series_id === cell.series_id && result.campaign?.cell_id === cell.cell_id)))) throw new Error("a campaign is only partially published; seed disclosure requires every cell");
    assertCampaignCommitConsistency(members);
  }
  return { results: collected.length, campaigns: plans.size };
}
