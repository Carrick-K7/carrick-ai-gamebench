#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import {
  LiteReleaseLockSchema,
  createLiteReleaseLock,
  findRepositoryRoot,
  listTasks,
  type JsonObject,
} from "@carrick/gamebench-core";
import { commandExists } from "./process.js";
import {
  checkLiteBenchmark,
  checkLitePublishedResults,
  loadLiteRelease,
  publishLiteBenchmark,
  runLiteBenchmark,
  runLitePreflight,
} from "./lite-runner.js";

const USAGE = `
Carrick AI GameBench 0.6 Lite

Usage:
  cagb doctor
  cagb bench --agent-command <command> --agent-id <id> [options]
  cagb check [--run <run-directory>]
  cagb publish --run <run-directory>

Bench options:
  --agent-version <version>   Default: unknown
  --model <model>             Default: unknown
  --model-params <json>       Score-relevant model parameters
  --harness <name>            Default: shell
  --lang <en|zh>              Default: en
  --output <directory>        Default: runs/0.6.0
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
      "agent-command": { type: "string" },
      "agent-id": { type: "string" },
      "agent-version": { type: "string", default: "unknown" },
      model: { type: "string", default: "unknown" },
      "model-params": { type: "string", default: "{}" },
      harness: { type: "string", default: "shell" },
      lang: { type: "string", default: "en" },
      output: { type: "string", default: "runs/0.6.0" },
      local: { type: "boolean", default: false },
    },
  }).values;
  const language = values.lang === "en" || values.lang === "zh"
    ? values.lang
    : fail("--lang must be en or zh");
  const agentCommand = typeof values["agent-command"] === "string"
    ? values["agent-command"]
    : fail("--agent-command is required");
  const agentId = typeof values["agent-id"] === "string"
    ? values["agent-id"]
    : fail("--agent-id is required");
  await validateCatalog(repositoryRoot);
  const tasks = await listTasks(repositoryRoot);
  const completed = await runLiteBenchmark(
    {
      repositoryRoot,
      outputRoot: path.resolve(repositoryRoot, String(values.output)),
      agentCommand,
      agentId,
      agentVersion: String(values["agent-version"]),
      model: String(values.model),
      modelParameters: parseModelParameters(String(values["model-params"])),
      harness: String(values.harness),
      language,
      official: !values.local,
    },
    tasks,
  );
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
    console.log(
      `PASS  GameBench ${release.benchmark_version}: ${release.tasks.length} Build tasks, ` +
        `${publicationCount} lightweight publications`,
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE.trim());
    return;
  }
  const repositoryRoot = await findRepositoryRoot();
  if (command === "doctor") {
    await commandDoctor(repositoryRoot);
  } else if (command === "bench") {
    await commandBench(repositoryRoot, args);
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
