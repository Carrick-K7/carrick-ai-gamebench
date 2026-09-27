import {
  CampaignPlanV2Schema,
  LiteResultIndexSchema,
  compareSemanticVersions,
  assertCampaignCommitConsistency,
  qualifyFlatSeriesV3,
  readFlatSeriesResult,
  readReleaseLock,
  sha256File,
  type AnyFlatSeriesResult,
  type AnyReleaseLockWithPlay,
  type CampaignPlanV2,
  type FlatSeriesResultV3,
  type SuiteQualification,
} from "@carrick/gamebench-core";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export interface SiteReleaseContext {
  lock: AnyReleaseLockWithPlay;
  /** SHA-256 of the actual lock FILE BYTES, never canonical JSON. */
  file_hash: string;
}

export interface QualifiedFlatSeries {
  result: FlatSeriesResultV3;
  qualification: SuiteQualification;
  /** All preregistered cells are indexed and have complete full-suite coverage. */
  campaign_complete: boolean;
  rankable: boolean;
}

export async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function siteResultsRoot(repositoryRoot: string): string {
  return process.env.GAMEBENCH_RESULTS_ROOT
    ? path.resolve(process.env.GAMEBENCH_RESULTS_ROOT)
    : path.join(repositoryRoot, "results");
}

export async function siteReleaseContexts(repositoryRoot: string): Promise<SiteReleaseContext[]> {
  const root = path.join(repositoryRoot, "benchmark", "releases");
  const files = (await readdir(root)).filter((file) => file.endsWith(".json"));
  const contexts = await Promise.all(files.map(async (file) => {
    const filePath = path.join(root, file);
    const lock = readReleaseLock(await readJson(filePath));
    if (file !== `${lock.benchmark_version}.json`) throw new Error(`release path mismatch: ${file}`);
    return { lock, file_hash: `sha256:${await sha256File(filePath)}` };
  }));
  return contexts.sort((left, right) =>
    compareSemanticVersions(right.lock.benchmark_version, left.lock.benchmark_version),
  );
}

/** The ONE flat ledger. Indexed means published; there is no status field.
 * Missing index means no flat publications. Never scan files or a second ledger.
 */
export async function canonicalFlatResults(resultsRoot: string): Promise<AnyFlatSeriesResult[]> {
  let input: unknown;
  try {
    input = await readJson(path.join(resultsRoot, "lite", "index.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const index = LiteResultIndexSchema.parse(input);
  return Promise.all(index.results.map(async (entry) => {
    const expected = `results/lite/${entry.benchmark_version}/${entry.series_id}.json`;
    if (entry.path !== expected) throw new Error(`flat result path mismatch: ${entry.series_id}`);
    const result = readFlatSeriesResult(await readJson(path.join(resultsRoot, entry.path.slice("results/".length))));
    if (result.series_id !== entry.series_id || result.benchmark_version !== entry.benchmark_version) {
      throw new Error(`flat result index mismatch: ${entry.series_id}`);
    }
    return result;
  }));
}

export async function flatCampaignPlans(
  repositoryRoot: string,
  results: AnyFlatSeriesResult[],
): Promise<CampaignPlanV2[]> {
  const paths = new Set(results.flatMap((result) =>
    result.schema_version === 3 && result.campaign
      ? [path.join(repositoryRoot, "benchmark", "campaigns", result.benchmark_version, `${result.campaign.id}.json`)]
      : [],
  ));
  return Promise.all([...paths].map(async (filePath) => CampaignPlanV2Schema.parse(await readJson(filePath))));
}

/** Shared Core decides per-series completeness and tier. The site additionally
 * gates ranking on WHOLE-campaign publication, never just surviving cells.
 * Inputs must be the canonical indexed records; no unindexed files may enter.
 */
export function qualifyIndexedFlatResults(
  indexed: AnyFlatSeriesResult[],
  releases: SiteReleaseContext[],
  campaigns: CampaignPlanV2[],
): QualifiedFlatSeries[] {
  const results = indexed.filter((result): result is FlatSeriesResultV3 => result.schema_version === 3);
  const qualified = results.map((result) => {
    const context = releases.find(({ lock }) => lock.benchmark_version === result.benchmark_version);
    if (!context || context.lock.schema_version !== 4) {
      throw new Error(`V3 result references unknown V4 release: ${result.benchmark_version}`);
    }
    const plan = result.campaign ? campaigns.find((candidate) =>
      candidate.campaign_id === result.campaign!.id && candidate.benchmark_version === result.benchmark_version,
    ) : undefined;
    return {
      result,
      qualification: qualifyFlatSeriesV3(result, context.lock, context.file_hash, plan),
      plan,
    };
  });
  // Complete public cells from different source commits are not one Campaign.
  // Check even partial publication sets; completeness is a separate rank gate.
  for (const plan of campaigns) {
    assertCampaignCommitConsistency(qualified.filter((candidate) =>
      candidate.plan?.campaign_id === plan.campaign_id &&
      candidate.result.benchmark_version === plan.benchmark_version &&
      candidate.result.suite === plan.suite,
    ).map(({ result }) => result));
  }
  return qualified.map(({ result, qualification, plan }) => {
    const campaignComplete = !plan || plan.cells.every((cell) => qualified.some((candidate) =>
      candidate.result.benchmark_version === plan.benchmark_version &&
      candidate.result.suite === plan.suite &&
      candidate.result.series_id === cell.series_id &&
      candidate.result.campaign?.id === plan.campaign_id &&
      candidate.result.campaign.cell_id === cell.cell_id &&
      candidate.qualification.complete,
    ));
    return {
      result,
      qualification,
      campaign_complete: campaignComplete,
      rankable: qualification.complete && campaignComplete,
    };
  });
}
