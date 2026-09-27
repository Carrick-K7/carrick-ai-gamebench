import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  CampaignPlanSchema,
  LiteResultIndexSchema,
  assertCampaignCommitConsistency,
  canonicalJson,
  hashCampaignCellExecution,
  hashCampaignPlan,
  readFlatSeriesResult,
  sha256File,
  type CampaignCell,
  type CampaignPlan,
  type JsonObject,
  type LiteSeriesResult,
} from "@carrick/gamebench-core";
import {
  assertSecretFreePublication,
  checkLiteBenchmark,
  loadLiteRelease,
  type LiteBenchOptions,
} from "./lite-runner.js";
import { loadVersionedRelease } from "./suite-release.js";
import { publishCheckedResults } from "./publication.js";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function assertSlug(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} must be a lowercase path-safe slug`);
  }
}

function campaignPath(repositoryRoot: string, version: string, campaignId: string): string {
  assertSlug(campaignId, "campaign id");
  return path.join(repositoryRoot, "benchmark", "campaigns", version, `${campaignId}.json`);
}

function gitTracks(repositoryRoot: string, relativePath: string): boolean {
  return spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], {
    cwd: repositoryRoot,
    stdio: "ignore",
  }).status === 0;
}

export async function loadCampaignPlan(
  repositoryRoot: string,
  campaignId: string,
  benchmarkVersion?: string,
): Promise<{ plan: CampaignPlan; planPath: string; planHash: `sha256:${string}` }> {
  const { release, releaseHash } = await loadLiteRelease(repositoryRoot, benchmarkVersion);
  const planPath = campaignPath(repositoryRoot, release.benchmark_version, campaignId);
  const plan = CampaignPlanSchema.parse(JSON.parse(await readFile(planPath, "utf8")));
  if (plan.campaign_id !== campaignId) {
    throw new Error("campaign file name and campaign_id differ");
  }
  if (
    plan.benchmark_version !== release.benchmark_version ||
    plan.release_hash !== releaseHash
  ) {
    throw new Error(`campaign ${campaignId} does not match the loaded release lock`);
  }
  for (const cell of plan.cells) {
    const adapterPath = path.resolve(repositoryRoot, cell.adapter.path);
    const relative = path.relative(repositoryRoot, adapterPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${cell.cell_id}: adapter path escapes the repository`);
    }
    if (!gitTracks(repositoryRoot, relative)) {
      throw new Error(`${cell.cell_id}: adapter is not tracked by Git: ${relative}`);
    }
    const stats = await lstat(adapterPath);
    if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o111) === 0) {
      throw new Error(`${cell.cell_id}: adapter must be an executable regular tracked file`);
    }
    const hash = `sha256:${await sha256File(adapterPath)}`;
    if (hash !== cell.adapter.hash) {
      throw new Error(`${cell.cell_id}: adapter hash mismatch`);
    }
  }
  return { plan, planPath, planHash: hashCampaignPlan(plan) };
}

export async function listCampaignPlans(
  repositoryRoot: string,
  benchmarkVersion?: string,
): Promise<CampaignPlan[]> {
  const { release } = await loadLiteRelease(repositoryRoot, benchmarkVersion);
  const directory = path.join(
    repositoryRoot,
    "benchmark",
    "campaigns",
    release.benchmark_version,
  );
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const plans: CampaignPlan[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    plans.push(
      (await loadCampaignPlan(repositoryRoot, name.slice(0, -5), release.benchmark_version))
        .plan,
    );
  }
  return plans;
}

export function findCampaignCell(plan: CampaignPlan, cellId: string): CampaignCell {
  assertSlug(cellId, "cell id");
  const cell = plan.cells.find((candidate) => candidate.cell_id === cellId);
  if (!cell) {
    throw new Error(`unknown campaign cell: ${cellId}`);
  }
  return cell;
}

export function campaignBenchOptions(
  repositoryRoot: string,
  plan: CampaignPlan,
  cell: CampaignCell,
): Omit<LiteBenchOptions, "repositoryRoot" | "official"> {
  const adapterPath = path.resolve(repositoryRoot, cell.adapter.path);
  const thinking = cell.parameters.thinking;
  if (typeof thinking !== "string" || thinking.length === 0) {
    throw new Error(`${cell.cell_id}: parameters.thinking must be a string`);
  }
  const modelParameters: JsonObject = {
    ...cell.parameters,
    provider: cell.provider,
  };
  return {
    outputRoot: path.join(repositoryRoot, "runs", plan.benchmark_version),
    agentCommand: [adapterPath, cell.provider, cell.model, thinking]
      .map(shellQuote)
      .join(" "),
    agentId: cell.agent.id,
    agentVersion: cell.agent.version,
    model: cell.model,
    modelParameters,
    harness: cell.agent.id,
    language: cell.prompt_language,
    seriesId: cell.series_id,
    campaign: {
      id: plan.campaign_id,
      cell_id: cell.cell_id,
      plan_hash: hashCampaignPlan(plan),
      execution_hash: hashCampaignCellExecution(cell),
    },
  };
}

function expectedParameters(cell: CampaignCell): JsonObject {
  return { ...cell.parameters, provider: cell.provider };
}

export function assertResultMatchesCampaignCell(
  result: LiteSeriesResult,
  plan: CampaignPlan,
  cell: CampaignCell,
): void {
  if (
    result.benchmark_version !== plan.benchmark_version ||
    result.release_hash !== plan.release_hash ||
    result.profile !== "official" ||
    !result.source_tree_clean ||
    result.git_commit === "unknown" ||
    result.build.completed !== result.build.required ||
    result.build.score === undefined
  ) {
    throw new Error(`${cell.cell_id}: result is not a complete Official campaign row`);
  }
  const binding = result.campaign;
  if (
    !binding ||
    binding.id !== plan.campaign_id ||
    binding.cell_id !== cell.cell_id ||
    binding.plan_hash !== hashCampaignPlan(plan) ||
    binding.execution_hash !== hashCampaignCellExecution(cell)
  ) {
    throw new Error(`${cell.cell_id}: result campaign binding mismatch`);
  }
  if (result.series_id !== cell.series_id) {
    throw new Error(`${cell.cell_id}: result series_id differs from the preregistered id`);
  }
  const agent = result.configuration.agent;
  if (
    agent.id !== cell.agent.id ||
    agent.version !== cell.agent.version ||
    agent.model !== cell.model ||
    agent.harness !== cell.agent.id ||
    canonicalJson(agent.parameters) !== canonicalJson(expectedParameters(cell)) ||
    result.configuration.prompt_language !== cell.prompt_language
  ) {
    throw new Error(`${cell.cell_id}: result configuration differs from the campaign plan`);
  }
}

export async function assertCampaignCellMayStart(
  repositoryRoot: string,
  plan: CampaignPlan,
  cell: CampaignCell,
): Promise<void> {
  const position = plan.cells.findIndex((candidate) => candidate.cell_id === cell.cell_id);
  if (position < 0) {
    throw new Error(`unknown campaign cell: ${cell.cell_id}`);
  }
  const currentCommit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).stdout.trim();
  for (const previous of plan.cells.slice(0, position)) {
    const runDir = path.join(
      repositoryRoot,
      "runs",
      plan.benchmark_version,
      previous.series_id,
    );
    let result: LiteSeriesResult;
    try {
      result = await checkLiteBenchmark(repositoryRoot, runDir, true);
    } catch {
      throw new Error(
        `${cell.cell_id}: prior campaign cell is not complete: ${previous.cell_id}`,
      );
    }
    assertResultMatchesCampaignCell(result, plan, previous);
    assertCampaignCommitConsistency([result], currentCommit);
  }
}

export async function checkLocalCampaign(
  repositoryRoot: string,
  campaignId: string,
): Promise<Array<{ cell: CampaignCell; runDir: string; result: LiteSeriesResult }>> {
  const { plan } = await loadCampaignPlan(repositoryRoot, campaignId);
  const rows: Array<{ cell: CampaignCell; runDir: string; result: LiteSeriesResult }> = [];
  for (const cell of plan.cells) {
    const runDir = path.join(
      repositoryRoot,
      "runs",
      plan.benchmark_version,
      cell.series_id,
    );
    const result = await checkLiteBenchmark(repositoryRoot, runDir, true);
    assertResultMatchesCampaignCell(result, plan, cell);
    rows.push({ cell, runDir, result });
  }
  assertCampaignCommitConsistency(rows.map(({ result }) => result));
  return rows;
}

export async function publishCampaign(
  repositoryRoot: string,
  campaignId: string,
): Promise<string[]> {
  return publishCampaigns(repositoryRoot, [campaignId]);
}

export async function publishCampaigns(
  repositoryRoot: string,
  campaignIds: string[],
): Promise<string[]> {
  if (campaignIds.length === 0 || new Set(campaignIds).size !== campaignIds.length) {
    throw new Error("campaign publication requires unique campaign IDs");
  }
  const rows = (await Promise.all(
    campaignIds.map((campaignId) => checkLocalCampaign(repositoryRoot, campaignId)),
  )).flat();
  for (const { result } of rows) assertSecretFreePublication(result);
  return publishCheckedResults(repositoryRoot, rows.map(({ result }) => result));
}

export async function doctorCampaignAgents(repositoryRoot: string, suppliedPlans?: Array<{ cells: CampaignCell[] }>): Promise<number> {
  const plans = suppliedPlans ?? await listCampaignPlans(repositoryRoot);
  const checked = new Set<string>();
  for (const plan of plans) {
    for (const cell of plan.cells) {
      const identity = `${cell.agent.id}/${cell.agent.version}/${cell.provider}/${cell.model}`;
      if (checked.has(identity)) {
        continue;
      }
      if (cell.agent.id !== "pi") {
        throw new Error(`${cell.cell_id}: unsupported campaign Agent doctor: ${cell.agent.id}`);
      }
      const lookup = spawnSync("bash", ["-lic", "command -v pi"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const executable = lookup.status === 0 ? lookup.stdout.trim() : "";
      if (!executable) {
        throw new Error("Pi Agent executable was not found in the login shell");
      }
      const version = spawnSync(executable, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (version.status !== 0 || version.stdout.trim() !== cell.agent.version) {
        throw new Error(`${cell.cell_id}: Pi Agent version does not match the campaign plan`);
      }
      const catalog = spawnSync(executable, ["--list-models", cell.model], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (
        catalog.status !== 0 ||
        !catalog.stdout.includes(cell.provider) ||
        !catalog.stdout.includes(cell.model)
      ) {
        throw new Error(`${cell.cell_id}: Pi model is absent from the configured catalog`);
      }
      const auth = spawnSync(
        executable,
        ["auth", "check", "--provider", cell.provider, "--model", cell.model, "--json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      if (auth.status !== 0) {
        throw new Error(`${cell.cell_id}: Pi provider/model authentication is not ready`);
      }
      const status = JSON.parse(auth.stdout) as { status?: unknown };
      if (status.status !== "ready") {
        throw new Error(`${cell.cell_id}: Pi provider/model authentication is not ready`);
      }
      checked.add(identity);
    }
  }
  return checked.size;
}

export async function checkCampaignPublications(repositoryRoot: string): Promise<number> {
  const index = LiteResultIndexSchema.parse(
    JSON.parse(await readFile(path.join(repositoryRoot, "results", "lite", "index.json"), "utf8")),
  );
  const byBinding = new Map<string, LiteSeriesResult[]>();
  const indexedVersions = new Set<string>();
  for (const entry of index.results) {
    const result = readFlatSeriesResult(
      JSON.parse(await readFile(path.join(repositoryRoot, entry.path), "utf8")),
    );
    // A standalone campaign check must not ignore the index binding: the
    // flat index is the authoritative (benchmark_version, series_id) ledger,
    // so a result that differs from its index entry is an integrity failure
    // regardless of whether it carries a campaign binding.
    if (
      result.series_id !== entry.series_id ||
      result.benchmark_version !== entry.benchmark_version
    ) {
      throw new Error(`published result identity does not match the index entry: ${entry.series_id}`);
    }
    if (result.schema_version === 3) continue; // separately checked by Campaign v2
    indexedVersions.add(result.benchmark_version);
    if (result.campaign) {
      const key = `${result.benchmark_version}/${result.campaign.id}`;
      const values = byBinding.get(key) ?? [];
      values.push(result);
      byBinding.set(key, values);
    }
  }
  // Campaign bindings are validated against every release that has published
  // results, plus the currently active release. A campaign that was published
  // under a historical benchmark version (for example 0.6.0) remains known
  // even when the current release (0.6.1) declares no new campaign plans.
  const currentRelease = await loadVersionedRelease(repositoryRoot);
  const versionsToScan = new Set<string>([
    ...indexedVersions,
    ...("evaluation_seed" in currentRelease.release ? [currentRelease.release.benchmark_version] : []),
  ]);
  const plans = new Map<string, CampaignPlan>();
  for (const version of versionsToScan) {
    for (const plan of await listCampaignPlans(repositoryRoot, version)) {
      plans.set(`${plan.benchmark_version}/${plan.campaign_id}`, plan);
    }
  }
  const knownCampaigns = new Set(plans.keys());
  for (const key of byBinding.keys()) {
    if (!knownCampaigns.has(key)) {
      throw new Error(`published result references an unknown campaign: ${key}`);
    }
  }
  for (const [key, plan] of plans) {
    const values = byBinding.get(key) ?? [];
    if (values.length !== 0 && values.length !== plan.cells.length) {
      throw new Error(`campaign ${plan.campaign_id} is only partially published`);
    }
    const seen = new Set<string>();
    for (const result of values) {
      const cell = findCampaignCell(plan, result.campaign?.cell_id ?? "");
      if (seen.has(cell.cell_id)) {
        throw new Error(`campaign cell published more than once: ${cell.cell_id}`);
      }
      seen.add(cell.cell_id);
      assertResultMatchesCampaignCell(result, plan, cell);
    }
    assertCampaignCommitConsistency(values);
  }
  return plans.size;
}
