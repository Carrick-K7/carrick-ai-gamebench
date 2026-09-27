import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  CampaignPlanV2Schema, FlatSeriesResultV3Schema, campaignCellExecutionSpecV2Hash,
  assertCampaignCommitConsistency, campaignPlanV2Hash, qualifyFlatSeriesV3, sha256File,
  type CampaignCell, type CampaignPlanV2, type FlatSeriesResultV3,
} from "@carrick/gamebench-core";
import { gitState, loadSuiteRelease } from "./suite-release.js";
import { playEqual } from "./play/slot-audit.js";

export function campaignSlug(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) throw new Error("campaign/cell id must be a lowercase path-safe slug");
  return value;
}
export const quoteCommandArgument = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export async function loadCampaignV2(repositoryRoot: string, campaignId: string, version?: string, options: { forExecution?: boolean } = {}) {
  const loaded = await loadSuiteRelease(repositoryRoot, version);
  const planPath = path.join(repositoryRoot, "benchmark", "campaigns", loaded.release.benchmark_version, `${campaignSlug(campaignId)}.json`);
  const stat = await lstat(planPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("campaign plan must be a regular file");
  const plan = CampaignPlanV2Schema.parse(JSON.parse(await readFile(planPath, "utf8")));
  if (plan.campaign_id !== campaignId || plan.benchmark_version !== loaded.release.benchmark_version || plan.release_hash !== loaded.releaseHash) throw new Error("campaign differs from its canonical release/path binding");
  if (plan.suite === "play" && (plan.seed_commitment?.benchmark_version !== plan.benchmark_version || !playEqual(plan.seed_commitment.tasks, loaded.release.suites.play.tasks.map((task) => ({ task_id: task.id, episodes: task.episodes }))))) throw new Error("campaign seed commitment must cover the exact released Play games");
  for (const cell of options.forExecution === false ? [] : plan.cells) {
    const adapter = path.resolve(repositoryRoot, cell.adapter.path);
    const relative = path.relative(repositoryRoot, adapter);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("adapter path escapes the repository");
    if (spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], { cwd: repositoryRoot, stdio: "ignore" }).status !== 0) throw new Error("campaign adapter must be tracked by Git");
    const info = await lstat(adapter);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o111) === 0) throw new Error("campaign adapter must be a regular executable file, not a link");
    if (`sha256:${await sha256File(adapter)}` !== cell.adapter.hash) throw new Error(`${cell.cell_id}: adapter hash mismatch`);
    // This MVP's external adapter CLI applies exactly these settings. Never label
    // a temperature/etc. that was merely recorded but never passed to the agent.
    if (typeof cell.parameters.thinking !== "string" || Object.keys(cell.parameters).some((key) => key !== "thinking")) throw new Error("current campaign adapters support exactly parameters.thinking");
  }
  return { ...loaded, plan, planPath, planHash: campaignPlanV2Hash(plan) };
}

export async function listCampaignsV2(repositoryRoot: string, version?: string, options: { forExecution?: boolean } = {}): Promise<CampaignPlanV2[]> {
  const { release } = await loadSuiteRelease(repositoryRoot, version);
  const directory = path.join(repositoryRoot, "benchmark", "campaigns", release.benchmark_version);
  let names: string[];
  try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const plans: CampaignPlanV2[] = [];
  for (const name of names.filter((name) => name.endsWith(".json")).sort()) plans.push((await loadCampaignV2(repositoryRoot, name.slice(0, -5), release.benchmark_version, options)).plan);
  const seriesIds = new Set<string>();
  for (const plan of plans) for (const cell of plan.cells) {
    if (seriesIds.has(cell.series_id)) throw new Error("two preregistered campaigns reuse the same canonical series id");
    seriesIds.add(cell.series_id);
  }
  return plans;
}

export function findCampaignCellV2(plan: CampaignPlanV2, cellId: string): CampaignCell {
  const cell = plan.cells.find((entry) => entry.cell_id === campaignSlug(cellId));
  if (!cell) throw new Error(`unknown campaign cell: ${cellId}`);
  return cell;
}

export function campaignV2ExecutionOptions(repositoryRoot: string, plan: CampaignPlanV2, cell: CampaignCell) {
  if (typeof cell.parameters.thinking !== "string" || Object.keys(cell.parameters).some((key) => key !== "thinking")) throw new Error("current campaign adapters support exactly parameters.thinking");
  return {
    repositoryRoot, benchmarkVersion: plan.benchmark_version,
    outputRoot: path.join(repositoryRoot, "runs", plan.benchmark_version), seriesId: cell.series_id,
    official: true, agentCommand: [path.resolve(repositoryRoot, cell.adapter.path), cell.provider, cell.model, String(cell.parameters.thinking)].map(quoteCommandArgument).join(" "),
    agentId: cell.agent.id, agentVersion: cell.agent.version, model: cell.model,
    modelParameters: { ...cell.parameters, provider: cell.provider }, harness: cell.agent.id, language: cell.prompt_language,
    configuration: {
      agent: { id: cell.agent.id, version: cell.agent.version, model: cell.model, harness: cell.agent.id, parameters: { ...cell.parameters, provider: cell.provider } },
      prompt_language: cell.prompt_language,
    },
    identity: { agent: cell.agent.id, version: cell.agent.version, provider: cell.provider, model: cell.model, thinking: String(cell.parameters.thinking) },
    campaign: { id: plan.campaign_id, cell_id: cell.cell_id, suite: plan.suite, plan_hash: campaignPlanV2Hash(plan), execution_hash: campaignCellExecutionSpecV2Hash(cell, plan.suite, plan.protocol) },
    campaignPlan: plan,
  };
}

/** Check the exact prior-cell order and refuse reused/aborted series directories. */
export async function assertCampaignV2MayStart(repositoryRoot: string, plan: CampaignPlanV2, cell: CampaignCell): Promise<void> {
  const { release, releaseHash } = await loadSuiteRelease(repositoryRoot, plan.benchmark_version);
  await listCampaignsV2(repositoryRoot, plan.benchmark_version);
  const own = path.join(repositoryRoot, "runs", plan.benchmark_version, cell.series_id);
  // lstat instead of following a dangling symlink or treating it as a new run.
  try { await lstat(own); throw new Error("campaign series directory already exists; never reuse/resample a cell"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const index = plan.cells.findIndex((entry) => entry.cell_id === cell.cell_id);
  if (index < 0 || !plan.cells[index] || plan.cells[index]!.series_id !== cell.series_id) throw new Error("cell is not in this campaign");
  const currentCommit = gitState(repositoryRoot).commit;
  for (const prior of plan.cells.slice(0, index)) {
    const runDir = path.join(repositoryRoot, "runs", plan.benchmark_version, prior.series_id);
    const marker = JSON.parse(await readFile(path.join(runDir, ".series.json"), "utf8")) as Record<string, unknown>;
    const result = FlatSeriesResultV3Schema.parse(JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8")));
    if (marker.status !== "complete" || marker.plan_hash !== campaignPlanV2Hash(plan) || marker.cell_id !== prior.cell_id || result.series_id !== prior.series_id || !qualifyFlatSeriesV3(result, release, releaseHash, plan).complete) throw new Error("preregistered prior cell is not complete; do not continue after a failed cell");
    assertCampaignCommitConsistency([result], currentCommit);
  }
}

/** A claimed clean commit must actually contain the preregistered plan, not a later plan. */
export function assertCampaignAtRecordedCommit(repositoryRoot: string, result: Pick<FlatSeriesResultV3, "git_commit">, plan: CampaignPlanV2): void {
  const relative = `benchmark/campaigns/${plan.benchmark_version}/${plan.campaign_id}.json`;
  const content = spawnSync("git", ["show", `${result.git_commit}:${relative}`], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (content.status !== 0) throw new Error("the recorded benchmark commit does not contain its preregistered campaign plan");
  const recorded = CampaignPlanV2Schema.parse(JSON.parse(content.stdout));
  if (campaignPlanV2Hash(recorded) !== campaignPlanV2Hash(plan)) throw new Error("campaign was changed after the recorded benchmark commit");
  for (const [file, expected] of [[`benchmark/releases/${plan.benchmark_version}.json`, plan.release_hash], ...plan.cells.map((cell) => [cell.adapter.path, cell.adapter.hash])] as Array<[string, string]>) {
    const blob = spawnSync("git", ["show", `${result.git_commit}:${file}`], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "ignore"] });
    if (blob.status !== 0 || `sha256:${createHash("sha256").update(blob.stdout).digest("hex")}` !== expected) throw new Error("recorded commit does not contain the preregistered release/adapter bytes");
  }
}
