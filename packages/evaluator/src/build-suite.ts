import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  CampaignPlanV2Schema,
  FlatSeriesResultBuildV3Schema,
  campaignCellExecutionSpecV2Hash,
  campaignPlanV2Hash,
  canonicalJson,
  createUlid,
  listTasks,
  qualifyFlatSeriesV3,
  summarizeLiteBuild,
  writeJson,
  type CampaignPlanV2,
  type FlatSeriesResultBuildV3,
  type LiteTaskResult,
  type SuiteQualification,
} from "@carrick/gamebench-core";
import { assertCampaignAtRecordedCommit, campaignV2ExecutionOptions } from "./campaign-v2-io.js";
import { runBuildTaskBatch } from "./build-tasks.js";
import { assertSecretFreeSuiteConfiguration } from "./suite-configuration.js";
import {
  checkLiteTaskEvidence,
  createSeriesRunDirectory,
  runLitePreflight,
  runLiteTask,
  type LiteBenchOptions,
} from "./lite-runner.js";
import {
  assertSuiteCatalog,
  gitState,
  loadSuiteRelease,
  requireOfficialSource,
} from "./suite-release.js";

/**
 * V4 Build suite wrapper.
 *
 * The Build instrument is the frozen v0.6 scoring/execution pipeline: it reuses
 * the exact `runLiteTask` (four tasks, one 3600s agent call each, canonical seed
 * 104729, the same evaluation-retry/infrastructure behavior) and
 * `checkLiteTaskEvidence` (hash binds source archive, agent record, scored
 * evidence and artifact manifest). Nothing here re-implements task scoring;
 * the only new surface is the v3 flat Build envelope (schema_version 3, suite
 * "build", benchmark "carrick-ai-gamebench", campaign v2 binding) and its
 * marker. `source_hash` / `artifact_manifest_hash` come from the sealed run
 * evidence and are never fabricated.
 */

export interface RunBuildSuiteOptions
  extends Omit<LiteBenchOptions, "campaign"> {
  /** V4 benchmark version (defaults to the active package version). */
  benchmarkVersion?: string;
  /** Campaign v2 binding; its plan must be provided and validated pre-call. */
  campaign?: FlatSeriesResultBuildV3["campaign"];
  campaignPlan?: CampaignPlanV2;
}

export interface CheckBuildSuiteOptions {
  repositoryRoot: string;
  runDir: string;
  /** Optional; `undefined` (explicitly) is allowed for an unbound result. */
  campaignPlan?: CampaignPlanV2 | undefined;
  requireComplete?: boolean;
}

export interface CheckBuildSuiteResult {
  result: FlatSeriesResultBuildV3;
  qualification: SuiteQualification;
}

/** The release's Build suite projected onto the Lite evidence-check shape. */
function liteEvidenceRelease(
  release: Awaited<ReturnType<typeof loadSuiteRelease>>["release"],
): { tasks: Array<{ id: string; version: string; hash: string }>; evaluation_seed: 104729 } {
  return {
    tasks: release.suites.build.tasks,
    evaluation_seed: release.suites.build.evaluation_seed,
  };
}

/** The actual execution configuration a Build run records (built from options). */
function configurationForSuite(
  options: RunBuildSuiteOptions,
): FlatSeriesResultBuildV3["configuration"] {
  return {
    agent: {
      id: options.agentId,
      version: options.agentVersion,
      model: options.model,
      harness: options.harness,
      parameters: options.modelParameters,
    },
    prompt_language: options.language,
  };
}

/** The exact configuration `qualifyFlatSeriesV3` expects for a campaign cell. */
function campaignCellConfiguration(cell: {
  agent: { id: string; version: string };
  provider: string;
  model: string;
  parameters: Record<string, unknown>;
  prompt_language: "en" | "zh";
}): FlatSeriesResultBuildV3["configuration"] {
  return {
    agent: {
      id: cell.agent.id,
      version: cell.agent.version,
      model: cell.model,
      harness: cell.agent.id,
      parameters: { ...cell.parameters, provider: cell.provider },
    },
    prompt_language: cell.prompt_language,
  };
}

/**
 * Validate a campaign v2 binding against its plan, the exact release lock AND
 * the actual execution configuration, before any measured call. A Play-suite
 * plan or binding is rejected here so a Build run never charges Build calls
 * against a wrong-suite campaign, and a mismatch between the actual options and
 * the preregistered cell is rejected rather than papered over by synthesizing
 * the cell's configuration.
 */
export function assertCampaignV2Binding(input: {
  binding: NonNullable<FlatSeriesResultBuildV3["campaign"]>;
  plan: CampaignPlanV2;
  benchmarkVersion: string;
  releaseHash: string;
  seriesId: string;
  configuration: FlatSeriesResultBuildV3["configuration"];
}): void {
  const { binding, plan, benchmarkVersion, releaseHash, seriesId, configuration } = input;
  const planParsed = CampaignPlanV2Schema.parse(plan);
  if (planParsed.suite !== "build" || binding.suite !== "build") {
    throw new Error("an official Build suite requires a Build-suite preregistered campaign");
  }
  if (planParsed.suite !== binding.suite) throw new Error("campaign suite does not match the binding");
  if (planParsed.campaign_id !== binding.id) throw new Error("campaign id does not match the binding");
  if (planParsed.benchmark_version !== benchmarkVersion) throw new Error("campaign benchmark version differs from the release");
  if (planParsed.release_hash !== releaseHash) throw new Error("campaign release hash differs from the release lock");
  if (binding.plan_hash !== campaignPlanV2Hash(planParsed)) throw new Error("campaign plan hash differs from the binding");
  const cell = planParsed.cells.find((candidate) => candidate.cell_id === binding.cell_id);
  if (!cell) throw new Error("campaign binding references an unknown cell");
  if (cell.series_id !== seriesId) throw new Error("campaign cell series id does not match the run");
  if (binding.execution_hash !== campaignCellExecutionSpecV2Hash(cell, planParsed.suite, planParsed.protocol)) {
    throw new Error("campaign execution hash differs from the binding");
  }
  // Never replace the real execution config with the plan to force qualification.
  const actual = canonicalJson(configuration);
  const expected = canonicalJson(campaignCellConfiguration(cell));
  if (actual !== expected) {
    throw new Error("actual execution configuration differs from the preregistered campaign cell");
  }
}

/** Assemble the v3 flat Build result from a finished series (preserves all Lite fields). */
export function assembleBuildSuiteResult(input: {
  benchmarkVersion: string;
  releaseHash: string;
  seriesId: string;
  gitCommit: string;
  sourceTreeClean: boolean;
  official: boolean;
  configuration: FlatSeriesResultBuildV3["configuration"];
  campaign?: FlatSeriesResultBuildV3["campaign"];
  startedAt: string;
  finishedAt: string;
  tasks: LiteTaskResult[];
}): FlatSeriesResultBuildV3 {
  return FlatSeriesResultBuildV3Schema.parse({
    schema_version: 3,
    suite: "build",
    benchmark: "carrick-ai-gamebench",
    benchmark_version: input.benchmarkVersion,
    release_hash: input.releaseHash,
    series_id: input.seriesId,
    git_commit: input.gitCommit,
    source_tree_clean: input.sourceTreeClean,
    profile: input.official ? "official" : "local",
    configuration: input.configuration,
    ...(input.campaign ? { campaign: input.campaign } : {}),
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    tasks: input.tasks,
    build: summarizeLiteBuild(input.tasks, 4),
  });
}

interface SuiteMarker {
  schema_version: 2;
  suite: "build";
  benchmark_version: string;
  release_hash: string;
  series_id: string;
  campaign_id?: string;
  cell_id?: string;
  plan_hash?: string;
  status: "prepared" | "running" | "complete" | "aborted";
  started_at: string;
  finished_at?: string;
  aborted_at?: string;
  error?: string;
}

async function writeSuiteMarker(runDir: string, marker: SuiteMarker): Promise<void> {
  await writeJson(path.join(runDir, ".series.json"), marker);
}

/** Run the V4 Build suite: four Build tasks, one 3600s agent call, seed 104729. */
export async function runBuildSuite(
  options: RunBuildSuiteOptions,
): Promise<{ runDir: string; result: FlatSeriesResultBuildV3 }> {
  // An official suite is preregistered: it must have a campaign binding. Reject
  // before any preflight/measured call rather than charging four Build calls.
  if (options.official && !options.campaign) {
    throw new Error("an Official Build suite requires a preregistered campaign binding");
  }
  const actualConfiguration = configurationForSuite(options);
  assertSecretFreeSuiteConfiguration(actualConfiguration);
  const { release, releaseHash } = await loadSuiteRelease(
    options.repositoryRoot,
    options.benchmarkVersion,
  );
  await assertSuiteCatalog(options.repositoryRoot, release);

  const byId = new Map(
    (await listTasks(options.repositoryRoot)).map((task) => [task.manifest.id, task]),
  );
  const selected = release.suites.build.tasks.map((reference) => {
    const task = byId.get(reference.id);
    if (!task || task.hash !== reference.hash || task.manifest.version !== reference.version) {
      throw new Error(`release build task does not match the active catalog: ${reference.id}`);
    }
    return task;
  });

  let campaignPlan: CampaignPlanV2 | undefined;
  let campaign = options.campaign;
  let seriesId = options.seriesId;
  if (campaign) {
    if (!options.campaignPlan) throw new Error("a campaign binding requires its preregistered plan");
    campaignPlan = CampaignPlanV2Schema.parse(options.campaignPlan);
    const cell = campaignPlan.cells.find((candidate) => candidate.cell_id === campaign?.cell_id);
    if (!cell) throw new Error("campaign binding references an unknown cell");
    if (!seriesId) seriesId = cell.series_id;
    // Preregistered V2 config + actual execution config validated before any call.
    assertCampaignV2Binding({
      binding: campaign,
      plan: campaignPlan,
      benchmarkVersion: release.benchmark_version,
      releaseHash,
      seriesId,
      configuration: actualConfiguration,
    });
    // Canonical adapter-command guard: model labels are not proof we invoke the
    // preregistered adapter/args, so the exact invocation must match.
    const expected = campaignV2ExecutionOptions(options.repositoryRoot, campaignPlan, cell);
    if (expected.agentCommand !== options.agentCommand) {
      throw new Error("actual player command differs from the preregistered adapter invocation");
    }
  } else if (options.campaignPlan) {
    throw new Error("a campaign plan requires a campaign binding");
  }
  seriesId ??= createUlid();

  const state = gitState(options.repositoryRoot);
  if (options.official) {
    requireOfficialSource(options.repositoryRoot);
    // Close the ignored/untracked-plan loophole: the recorded clean commit must
    // already contain the preregistered plan + release + adapter bytes BEFORE
    // any measured (paid) task starts.
    if (campaignPlan) {
      assertCampaignAtRecordedCommit(options.repositoryRoot, { git_commit: state.commit }, campaignPlan);
    }
  }
  // The old Lite pipeline runs preflight for local runs too, not only official.
  await runLitePreflight(options.repositoryRoot);

  const startedAt = new Date().toISOString();
  const runDir = await createSeriesRunDirectory(options.outputRoot, seriesId);
  const markerBase: SuiteMarker = {
    schema_version: 2,
    suite: "build",
    benchmark_version: release.benchmark_version,
    release_hash: releaseHash,
    series_id: seriesId,
    ...(campaign ? { campaign_id: campaign.id, cell_id: campaign.cell_id, plan_hash: campaign.plan_hash } : {}),
    status: "prepared",
    started_at: startedAt,
  };
  await writeSuiteMarker(runDir, markerBase);
  await mkdir(path.join(runDir, "tasks"));

  try {
    await writeSuiteMarker(runDir, { ...markerBase, status: "running" });
    // The v3 campaign/benchmark-version fields are wrapper concerns; the Lite
    // task pipeline only needs the unchanged Lite execution options.
    const liteOptions: LiteBenchOptions = {
      repositoryRoot: options.repositoryRoot,
      outputRoot: options.outputRoot,
      agentCommand: options.agentCommand,
      agentId: options.agentId,
      agentVersion: options.agentVersion,
      model: options.model,
      modelParameters: options.modelParameters,
      harness: options.harness,
      language: options.language,
      official: options.official,
      ...(options.seriesId ? { seriesId: options.seriesId } : {}),
    };
    const { tasks: taskResults } = await runBuildTaskBatch(
      selected, runDir,
      (task) => runLiteTask(liteOptions, task, runDir, release.suites.build.evaluation_seed),
    );
    if ((await loadSuiteRelease(options.repositoryRoot, release.benchmark_version)).releaseHash !== releaseHash) throw new Error("release lock changed during measurement");
    const finishedAt = new Date().toISOString();
    const finalState = gitState(options.repositoryRoot);
    if (
      options.official &&
      (finalState.commit !== state.commit || !finalState.clean)
    ) {
      throw new Error("Git commit or working tree changed during the Official suite");
    }
    const result = assembleBuildSuiteResult({
      benchmarkVersion: release.benchmark_version,
      releaseHash,
      seriesId,
      gitCommit: /^[a-f0-9]{40}$/.test(state.commit) ? state.commit : "unknown",
      sourceTreeClean: state.clean && finalState.clean && state.commit === finalState.commit,
      official: options.official,
      configuration: actualConfiguration,
      ...(campaign ? { campaign } : {}),
      startedAt,
      finishedAt,
      tasks: taskResults,
    });
    qualifyFlatSeriesV3(result, release, releaseHash, campaignPlan);
    await writeJson(path.join(runDir, "result.json"), result);
    await writeSuiteMarker(runDir, { ...markerBase, status: "complete", finished_at: finishedAt });
    return { runDir, result };
  } catch (error) {
    await writeSuiteMarker(runDir, {
      ...markerBase,
      status: "aborted",
      aborted_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

/** Verify the canonical `.series.json` marker binds the run to its result. */
async function assertBuildSuiteMarker(
  runDir: string,
  result: FlatSeriesResultBuildV3,
): Promise<void> {
  const marker = JSON.parse(
    await readFile(path.join(runDir, ".series.json"), "utf8"),
  ) as Record<string, unknown>;
  if (marker.schema_version !== 2 || marker.suite !== "build") {
    throw new Error("invalid Build suite marker");
  }
  if (marker.series_id !== result.series_id) {
    throw new Error("marker series id differs from the result");
  }
  if (path.basename(runDir) !== result.series_id) {
    throw new Error("run directory basename is not the canonical series id");
  }
  if (marker.benchmark_version !== result.benchmark_version || marker.release_hash !== result.release_hash || path.basename(path.dirname(runDir)) !== result.benchmark_version) throw new Error("marker/directory differs from the canonical release version");
  if (marker.status !== "complete" || result.build.completed !== 4 || result.build.score === undefined) {
    throw new Error("suite marker is not a complete scored measurement");
  }
  if (marker.started_at !== result.started_at) {
    throw new Error("marker started_at differs from the result");
  }
  if (marker.finished_at !== result.finished_at) {
    throw new Error("marker finished_at differs from the result");
  }
  if (result.campaign) {
    if (
      marker.campaign_id !== result.campaign.id ||
      marker.cell_id !== result.campaign.cell_id ||
      marker.plan_hash !== result.campaign.plan_hash
    ) {
      throw new Error("marker campaign binding differs from the result");
    }
  } else if (marker.campaign_id !== undefined || marker.cell_id !== undefined || marker.plan_hash !== undefined) {
    throw new Error("marker claims a campaign the result does not");
  }
}

/** Verify a V4 Build suite run and qualify it against the exact release lock. */
export async function checkBuildSuite(
  options: CheckBuildSuiteOptions,
): Promise<CheckBuildSuiteResult> {
  const result = FlatSeriesResultBuildV3Schema.parse(
    JSON.parse(await readFile(path.join(options.runDir, "result.json"), "utf8")),
  );
  const { release, releaseHash } = await loadSuiteRelease(
    options.repositoryRoot,
    result.benchmark_version,
  );
  if (result.benchmark_version !== release.benchmark_version || result.release_hash !== releaseHash) {
    throw new Error("suite result does not match its release lock");
  }
  // The canonical marker `/series-id/.series.json` must bind the run identity,
  // lifecycle and campaign to the result. Source cleanliness is a RUN/PUBLISH
  // concern, verified elsewhere; a historical raw result may be checked in a
  // currently dirty tree.
  await assertBuildSuiteMarker(options.runDir, result);
  await checkLiteTaskEvidence(
    options.repositoryRoot,
    options.runDir,
    result,
    liteEvidenceRelease(release),
  );
  const qualification = qualifyFlatSeriesV3(
    result,
    release,
    releaseHash,
    options.campaignPlan,
  );
  if (options.requireComplete && !qualification.complete) {
    throw new Error("suite is not complete");
  }
  return { result, qualification };
}
