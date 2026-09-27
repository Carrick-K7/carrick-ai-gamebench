import { readFile } from "node:fs/promises";
import path from "node:path";
import { FlatSeriesResultV3Schema, type CampaignPlanV2 } from "@carrick/gamebench-core";
import { assertCampaignAtRecordedCommit, loadCampaignV2 } from "./campaign-v2-io.js";
import { checkBuildSuite } from "./build-suite.js";
import { checkPlaySeries } from "./play/check-series.js";

export async function checkSuiteRun(options: {
  repositoryRoot: string; runDir: string; campaignPlan?: CampaignPlanV2;
  requireComplete?: boolean; replayMode?: "engine" | "browser";
}) {
  const result = FlatSeriesResultV3Schema.parse(JSON.parse(await readFile(path.join(options.runDir, "result.json"), "utf8")));
  const campaignPlan = options.campaignPlan ?? (result.campaign ? (await loadCampaignV2(options.repositoryRoot, result.campaign.id, result.benchmark_version, { forExecution: false })).plan : undefined);
  const resolved = { ...options, ...(campaignPlan ? { campaignPlan } : {}) };
  const checked = result.suite === "play"
    ? await checkPlaySeries(resolved)
    : await checkBuildSuite(resolved);
  if (checked.qualification.tier === "official" && campaignPlan) assertCampaignAtRecordedCommit(options.repositoryRoot, result, campaignPlan);
  return checked;
}
