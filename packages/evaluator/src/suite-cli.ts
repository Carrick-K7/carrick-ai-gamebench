import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { readFlatSeriesResult, type JsonObject, type FlatSeriesResultV3 } from "@carrick/gamebench-core";
import { runBuildSuite } from "./build-suite.js";
import { checkCampaignPublications, doctorCampaignAgents } from "./campaign.js";
import { assertCampaignV2MayStart, campaignV2ExecutionOptions, findCampaignCellV2, listCampaignsV2, loadCampaignV2 } from "./campaign-v2-io.js";
import { checkLiteBenchmark, checkLitePublishedResults, publishLiteBenchmark, runLitePreflight } from "./lite-runner.js";
import { probePlayPlayer, runPlayDoctor } from "./play/doctor.js";
import { createPlaySeedBundle, createPlaySeedCommitment, readPrivatePlaySeedBundle, writePrivatePlaySeedBundle } from "./play/seeds.js";
import { runPlaySeries } from "./play/series.js";
import { assertSecretFreeSuiteConfiguration } from "./suite-configuration.js";
import { checkSuitePublishedResults, publishCampaignsV2, publishSuiteRun } from "./suite-publication.js";
import { assertSuiteCatalog, loadSuiteRelease, loadVersionedRelease } from "./suite-release.js";
import { checkSuiteRun } from "./suite-runs.js";

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required`);
  return value;
};
function suite(value: string | undefined): "build" | "play" {
  if (value !== "build" && value !== "play") throw new Error("--suite must be build or play");
  return value;
}
function parameters(text: string | undefined): JsonObject {
  const value: unknown = JSON.parse(text ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("--model-params must be a JSON object");
  assertSecretFreeSuiteConfiguration(value);
  return value as JsonObject;
}
function printResult(result: FlatSeriesResultV3): void {
  if (result.suite === "build") console.log(result.build.score === undefined ? "UNSCORED Build" : `BUILD ${result.build.score.toFixed(4)}`);
  else for (const game of result.games) {
    console.log(game.metrics === undefined ? `UNSCORED ${game.game}` : "mean_score" in game.metrics ? `2048 mean_score ${game.metrics.mean_score}` : `MINESWEEPER win_rate ${game.metrics.win_rate}`);
  }
}
async function checkPublic(repositoryRoot: string): Promise<void> {
  const { release } = await loadSuiteRelease(repositoryRoot);
  await assertSuiteCatalog(repositoryRoot, release);
  const legacy = await checkLitePublishedResults(repositoryRoot);
  const legacyCampaigns = await checkCampaignPublications(repositoryRoot);
  const current = await checkSuitePublishedResults(repositoryRoot);
  console.log(`PASS ${release.benchmark_version}: 4 Build + 2 Play tasks, ${legacy + current.results} flat publications, ${legacyCampaigns + current.campaigns} campaigns`);
}

export async function suiteBench(repositoryRoot: string, args: string[]): Promise<void> {
  const v = parseArgs({ args, strict: true, options: {
    suite: { type: "string" }, "benchmark-version": { type: "string" }, campaign: { type: "string" }, cell: { type: "string" },
    "seed-bundle": { type: "string" }, local: { type: "boolean", default: false }, "agent-command": { type: "string" },
    "agent-id": { type: "string" }, "agent-version": { type: "string" }, model: { type: "string" }, provider: { type: "string" },
    "model-params": { type: "string" }, harness: { type: "string" }, lang: { type: "string" }, output: { type: "string" },
  } }).values;
  const { release } = await loadSuiteRelease(repositoryRoot, v["benchmark-version"]);
  if (v.campaign || v.cell) {
    const forbidden = ["local", "agent-command", "agent-id", "agent-version", "model", "provider", "model-params", "harness", "lang", "output"];
    if (args.some((arg) => forbidden.some((flag) => arg === `--${flag}` || arg.startsWith(`--${flag}=`)))) throw new Error("campaign execution rejects independent configuration overrides");
    const { plan } = await loadCampaignV2(repositoryRoot, required(v.campaign, "--campaign"), release.benchmark_version);
    if (v.suite && suite(v.suite) !== plan.suite) throw new Error("--suite differs from the preregistered campaign");
    const cell = findCampaignCellV2(plan, required(v.cell, "--cell"));
    await assertCampaignV2MayStart(repositoryRoot, plan, cell);
    const options = campaignV2ExecutionOptions(repositoryRoot, plan, cell);
    if (plan.suite === "play") {
      const seedBundle = await readPrivatePlaySeedBundle(path.resolve(required(v["seed-bundle"], "--seed-bundle")));
      await probePlayPlayer(options.agentCommand, options.identity);
      const completed = await runPlaySeries({ ...options, seedBundle });
      console.log(`RESULT ${completed.runDir}`); printResult(completed.result);
      if (completed.result.games.length !== 2 || completed.result.games.some((game) => !game.metrics)) process.exitCode = 1;
    } else {
      if (v["seed-bundle"]) throw new Error("Build uses only the frozen evaluation seed 104729");
      await doctorCampaignAgents(repositoryRoot, [{ cells: [cell] }]);
      const completed = await runBuildSuite(options);
      console.log(`RESULT ${completed.runDir}`); printResult(completed.result);
    }
    return;
  }
  if (!v.local) throw new Error("Official bench requires --campaign and --cell; use --local for experiments");
  if (v.output !== undefined) throw new Error("run paths are fixed at runs/<version>/<series-id>");
  const selected = suite(v.suite ?? "build");
  const agentCommand = required(v["agent-command"], "--agent-command");
  const modelParameters = parameters(v["model-params"]);
  const language = v.lang ?? "en";
  if (language !== "en" && language !== "zh") throw new Error("--lang must be en or zh");
  const common = { repositoryRoot, benchmarkVersion: release.benchmark_version, outputRoot: path.join(repositoryRoot, "runs", release.benchmark_version), official: false, agentCommand };
  if (selected === "build") {
    if (v["seed-bundle"]) throw new Error("Build does not accept a Play seed bundle");
    const completed = await runBuildSuite({ ...common, agentId: required(v["agent-id"], "--agent-id"), agentVersion: v["agent-version"] ?? "unknown", model: v.model ?? "unknown", modelParameters, harness: v.harness ?? "shell", language });
    console.log(`RESULT ${completed.runDir}`); printResult(completed.result);
  } else {
    const identity = await probePlayPlayer(agentCommand);
    for (const [declared, actual] of [[v["agent-id"], identity.agent], [v["agent-version"], identity.version], [v.model, identity.model], [v.provider, identity.provider], [modelParameters.provider, identity.provider], [modelParameters.thinking, identity.thinking]]) if (declared !== undefined && declared !== actual) throw new Error("declared identity differs from the actual Play adapter");
    const seedBundle = v["seed-bundle"] ? await readPrivatePlaySeedBundle(path.resolve(v["seed-bundle"])) : createPlaySeedBundle(release);
    const completed = await runPlaySeries({ ...common, identity, seedBundle, configuration: {
      agent: { id: identity.agent, version: identity.version, model: identity.model, harness: v.harness ?? identity.agent, parameters: { ...modelParameters, provider: identity.provider, thinking: identity.thinking } }, prompt_language: language,
    } });
    console.log(`RESULT ${completed.runDir}`); printResult(completed.result);
    if (completed.result.games.length !== 2 || completed.result.games.some((game) => !game.metrics)) process.exitCode = 1;
  }
}

/** Return false only for commands belonging to the unchanged legacy CLI. */
export async function trySuiteCommand(repositoryRoot: string, command: string, args: string[]): Promise<boolean> {
  if (command === "check" || command === "publish" || command === "replay") {
    const v = parseArgs({ args, strict: true, options: { run: { type: "string" }, "engine-only": { type: "boolean", default: false } } }).values;
    if (command === "publish" && v["engine-only"]) throw new Error("publication requires native browser replay");
    if (!v.run) {
      if (command !== "check" || v["engine-only"]) throw new Error("--run is required");
      if ((await loadVersionedRelease(repositoryRoot)).release.schema_version !== 4) return false;
      await checkPublic(repositoryRoot); return true;
    }
    const runDir = path.resolve(repositoryRoot, v.run);
    const result = readFlatSeriesResult(JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8")));
    if (result.schema_version === 2) {
      if (command === "replay" || v["engine-only"]) throw new Error("Play replay does not apply to a legacy Build result");
      if (command === "publish") console.log(`PUBLISHED ${await publishLiteBenchmark(repositoryRoot, runDir)}`);
      else { await checkLiteBenchmark(repositoryRoot, runDir); console.log(`PASS ${result.series_id}`); }
    } else if (command === "publish") console.log(`PUBLISHED ${await publishSuiteRun(repositoryRoot, runDir)}`);
    else {
      if ((command === "replay" || v["engine-only"]) && result.suite !== "play") throw new Error("native replay is a Play command");
      const checked = await checkSuiteRun({ repositoryRoot, runDir, replayMode: v["engine-only"] ? "engine" : "browser" });
      console.log(`${checked.qualification.complete ? "PASS" : "UNSCORED"} ${result.series_id}${v["engine-only"] ? " (engine-only; not visual verification)" : ""}`);
      printResult(checked.result);
    }
    return true;
  }
  if (command === "play" && args[0] === "seeds") {
    const v = parseArgs({ args: args.slice(1), strict: true, options: { output: { type: "string" }, "benchmark-version": { type: "string" } } }).values;
    const { release } = await loadSuiteRelease(repositoryRoot, v["benchmark-version"]);
    const output = path.resolve(required(v.output, "--output"));
    const relative = path.relative(repositoryRoot, output);
    if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("keep preregistration seeds outside the repository; only their commitment belongs in Git");
    const bundle = createPlaySeedBundle(release);
    await writePrivatePlaySeedBundle(output, bundle);
    console.log(JSON.stringify(createPlaySeedCommitment(bundle), null, 2));
    return true;
  }
  const active = await loadVersionedRelease(repositoryRoot);
  if (active.release.schema_version !== 4) return false;
  if (command === "bench") { await suiteBench(repositoryRoot, args); return true; }
  if (command === "doctor") {
    const v = parseArgs({ args, strict: true, options: { suite: { type: "string" } } }).values;
    const selected = v.suite ? suite(v.suite) : undefined;
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8", timeout: 15_000 });
    if (!(major > 22 || major === 22 && minor >= 12) || pnpm.status !== 0 || pnpm.stdout.trim() !== "10.33.0") throw new Error("doctor requires Node >=22.12 and pnpm 10.33.0");
    await assertSuiteCatalog(repositoryRoot, active.release);
    if (!selected || selected === "build") { await runLitePreflight(repositoryRoot); console.log("PASS Build install/offline/build/browser preflight"); }
    if (!selected || selected === "play") { await runPlayDoctor(repositoryRoot); console.log("PASS Play 2048/Minesweeper native screenshots and model-free adapter"); }
    const plans = (await listCampaignsV2(repositoryRoot)).filter((plan) => !selected || plan.suite === selected);
    await doctorCampaignAgents(repositoryRoot, plans.filter((plan) => plan.suite === "build"));
    for (const plan of plans.filter((plan) => plan.suite === "play")) for (const cell of plan.cells) { const o = campaignV2ExecutionOptions(repositoryRoot, plan, cell); await probePlayPlayer(o.agentCommand, o.identity); }
    console.log(`PASS ${plans.length} preregistered campaigns (no model calls)`);
    return true;
  }
  if (command === "campaign") {
    if (args[0] === "check") { if (args.length !== 1) throw new Error("campaign check accepts no extra arguments"); await checkPublic(repositoryRoot); return true; }
    if (args[0] === "publish") {
      const v = parseArgs({ args: args.slice(1), strict: true, options: { id: { type: "string", multiple: true }, "benchmark-version": { type: "string" } } }).values;
      const destinations = await publishCampaignsV2(repositoryRoot, v.id ?? [], v["benchmark-version"]);
      console.log(`PUBLISHED ${destinations.length} series`); return true;
    }
    throw new Error("campaign requires check or publish");
  }
  return false;
}
