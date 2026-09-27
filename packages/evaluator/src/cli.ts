#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import {
  LITE_BENCHMARK_VERSION,
  LiteReleaseLockSchema,
  createLiteReleaseLock,
  findRepositoryRoot,
  listTasks,
  type JsonObject,
} from "@carrick/gamebench-core";
import {
  assertCampaignCellMayStart,
  campaignBenchOptions,
  checkCampaignPublications,
  doctorCampaignAgents,
  findCampaignCell,
  loadCampaignPlan,
  publishCampaigns,
} from "./campaign.js";
import { commandExists } from "./process.js";
import { BUILD_PLAY_BENCHMARK_VERSION } from "./suite-release.js";
import { trySuiteCommand } from "./suite-cli.js";
import {
  checkLiteBenchmark,
  checkLitePublishedResults,
  loadLiteRelease,
  publishLiteBenchmark,
  runLiteBenchmark,
  runLitePreflight,
  type LiteBenchOptions,
} from "./lite-runner.js";

const USAGE = `
Carrick AI GameBench — Build / Play (legacy ${LITE_BENCHMARK_VERSION} retained)

Usage:
  cagb --version
  cagb doctor [--suite build|play]
  cagb bench --suite build --campaign <id> --cell <id>
  cagb bench --suite play --campaign <id> --cell <id> --seed-bundle <private-file>
  cagb play seeds --output <private-file-outside-repository>
  cagb replay --run <play-run-directory> [--engine-only]
  cagb bench --campaign <id> --cell <id>
  cagb bench --local --agent-command <command> --agent-id <id> [options]
  cagb campaign check
  cagb campaign publish --id <campaign-id> [--id <campaign-id> ...]
  cagb check [--run <run-directory>]
  cagb publish --run <run-directory>   # non-campaign result only

Local bench options:
  --agent-version <version>   Default: unknown
  --model <model>             Default: unknown
  --model-params <json>       Score-relevant model parameters
  --harness <name>            Default: shell
  --lang <en|zh>              Default: en
  --local                     Allow a dirty tree and mark the result local
`;

function fail(message: string): never {
  throw new Error(message);
}

async function validateCatalog(repositoryRoot: string): Promise<void> {
  const tasks = await listTasks(repositoryRoot);
  const { release, releasePath } = await loadLiteRelease(repositoryRoot);
  const expected = createLiteReleaseLock(release.benchmark_version, tasks);
  if (JSON.stringify(LiteReleaseLockSchema.parse(release)) !== JSON.stringify(expected)) {
    throw new Error(
      `${path.relative(repositoryRoot, releasePath)} does not match the active four-task catalog`,
    );
  }
}

async function commandDoctor(repositoryRoot: string): Promise<void> {
  const [nodeMajor = 0, nodeMinor = 0] = process.versions.node
    .split(".")
    .map(Number);
  const pnpmVersion = spawnSync("pnpm", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).stdout.trim();
  const basic = [
    {
      name: "Node.js >=22.12",
      ok: nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12),
    },
    { name: "pnpm 10.33.0", ok: commandExists("pnpm") && pnpmVersion === "10.33.0" },
    { name: "tar", ok: commandExists("tar") },
    { name: "zstd", ok: commandExists("zstd") },
  ];
  for (const check of basic) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
  }
  if (basic.some((check) => !check.ok)) {
    throw new Error("basic preflight requirements are unavailable");
  }
  await validateCatalog(repositoryRoot);
  console.log("PASS  Four-task release catalog");
  await runLitePreflight(repositoryRoot);
  console.log("PASS  Fresh install, offline reinstall, build, preview, Chromium, and bridge smoke");
  const campaignAgentCount = await doctorCampaignAgents(repositoryRoot);
  console.log(`PASS  ${campaignAgentCount} planned Pi provider/model configuration${campaignAgentCount === 1 ? "" : "s"}`);
}

function parseModelParameters(value: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `--model-params must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--model-params must be a JSON object");
  }
  return parsed as JsonObject;
}

async function commandBench(repositoryRoot: string, args: string[]): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: {
      campaign: { type: "string" },
      cell: { type: "string" },
      "agent-command": { type: "string" },
      "agent-id": { type: "string" },
      "agent-version": { type: "string", default: "unknown" },
      model: { type: "string", default: "unknown" },
      "model-params": { type: "string", default: "{}" },
      harness: { type: "string", default: "shell" },
      lang: { type: "string", default: "en" },
      output: { type: "string" },
      local: { type: "boolean", default: false },
    },
  }).values;
  await validateCatalog(repositoryRoot);
  const tasks = await listTasks(repositoryRoot);
  const campaignId = values.campaign;
  const cellId = values.cell;
  let options: LiteBenchOptions;
  if (typeof campaignId === "string" || typeof cellId === "string") {
    const forbiddenCampaignFlags = [
      "--agent-command",
      "--agent-id",
      "--agent-version",
      "--model",
      "--model-params",
      "--harness",
      "--lang",
      "--output",
      "--local",
    ];
    if (
      args.some((argument) =>
        forbiddenCampaignFlags.some((flag) => argument === flag || argument.startsWith(`${flag}=`))
      )
    ) {
      fail("campaign runs reject independent Agent, model, language, output, and profile flags");
    }
    if (typeof campaignId !== "string" || typeof cellId !== "string") {
      fail("--campaign and --cell are required together");
    }
    if (values.local) {
      fail("campaign cells are Official single-shot runs and may not use --local");
    }
    if (
      values["agent-command"] !== undefined ||
      values["agent-id"] !== undefined ||
      values.output !== undefined
    ) {
      fail("campaign runs derive Agent identity, command, and output from the plan");
    }
    const { plan } = await loadCampaignPlan(repositoryRoot, campaignId);
    const cell = findCampaignCell(plan, cellId);
    await assertCampaignCellMayStart(repositoryRoot, plan, cell);
    options = {
      repositoryRoot,
      official: true,
      ...campaignBenchOptions(repositoryRoot, plan, cell),
    };
  } else {
    if (!values.local) {
      fail("Official bench requires --campaign and --cell");
    }
    const language = values.lang === "en" || values.lang === "zh"
      ? values.lang
      : fail("--lang must be en or zh");
    const agentCommand = typeof values["agent-command"] === "string"
      ? values["agent-command"]
      : fail("--agent-command is required");
    const agentId = typeof values["agent-id"] === "string"
      ? values["agent-id"]
      : fail("--agent-id is required");
    if (values.output !== undefined) {
      fail("run directories are fixed at runs/<benchmark-version>/<series-id>");
    }
    const { release } = await loadLiteRelease(repositoryRoot);
    const outputRoot = path.join(repositoryRoot, "runs", release.benchmark_version);
    options = {
      repositoryRoot,
      outputRoot,
      agentCommand,
      agentId,
      agentVersion: String(values["agent-version"]),
      model: String(values.model),
      modelParameters: parseModelParameters(String(values["model-params"])),
      harness: String(values.harness),
      language,
      official: false,
    };
  }
  const completed = await runLiteBenchmark(options, tasks);
  console.log(`RESULT  ${completed.runDir}`);
  console.log(
    completed.result.build.score === undefined
      ? `INCOMPLETE  ${completed.result.build.completed}/${completed.result.build.required}`
      : `BUILD  ${completed.result.build.score.toFixed(4)}`,
  );
}

async function commandCheck(repositoryRoot: string, args: string[]): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: { run: { type: "string" } },
  }).values;
  await validateCatalog(repositoryRoot);
  if (typeof values.run !== "string") {
    const { release } = await loadLiteRelease(repositoryRoot);
    const publicationCount = await checkLitePublishedResults(repositoryRoot);
    const campaignCount = await checkCampaignPublications(repositoryRoot);
    console.log(
      `PASS  GameBench ${release.benchmark_version}: ${release.tasks.length} Build tasks, ` +
        `${publicationCount} lightweight publications, ${campaignCount} campaign plans`,
    );
    return;
  }
  const runDir = path.resolve(repositoryRoot, values.run);
  const result = await checkLiteBenchmark(repositoryRoot, runDir);
  console.log(
    `PASS  ${result.series_id}: ${result.build.completed}/${result.build.required}` +
      (result.build.score === undefined ? "" : `, Build ${result.build.score.toFixed(4)}`),
  );
}

async function commandPublish(repositoryRoot: string, args: string[]): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: { run: { type: "string" } },
  }).values;
  const runDir = path.resolve(
    repositoryRoot,
    typeof values.run === "string" ? values.run : fail("--run is required"),
  );
  const destination = await publishLiteBenchmark(repositoryRoot, runDir);
  console.log(`PUBLISHED  ${path.relative(repositoryRoot, destination)}`);
}

async function commandCampaign(repositoryRoot: string, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (action === "check") {
    if (rest.length > 0) {
      fail("cagb campaign check accepts no additional arguments");
    }
    await validateCatalog(repositoryRoot);
    const count = await checkCampaignPublications(repositoryRoot);
    console.log(`PASS  ${count} campaign plan${count === 1 ? "" : "s"}`);
    return;
  }
  if (action === "publish") {
    const values = parseArgs({
      args: rest,
      strict: true,
      options: { id: { type: "string", multiple: true } },
    }).values;
    const campaignIds = Array.isArray(values.id) ? values.id : fail("--id is required");
    const destinations = await publishCampaigns(repositoryRoot, campaignIds);
    console.log(`PUBLISHED  ${campaignIds.join(", ")}: ${destinations.length} series`);
    return;
  }
  fail("campaign command requires check or publish");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--version" || command === "-V") {
    console.log(BUILD_PLAY_BENCHMARK_VERSION);
    return;
  }
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE.trim());
    return;
  }
  const repositoryRoot = await findRepositoryRoot();
  if (await trySuiteCommand(repositoryRoot, command, args)) return;
  if (command === "doctor") {
    await commandDoctor(repositoryRoot);
  } else if (command === "bench") {
    await commandBench(repositoryRoot, args);
  } else if (command === "campaign") {
    await commandCampaign(repositoryRoot, args);
  } else if (command === "check") {
    await commandCheck(repositoryRoot, args);
  } else if (command === "publish") {
    await commandPublish(repositoryRoot, args);
  } else {
    fail(`Unknown command: ${command}\n${USAGE}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
