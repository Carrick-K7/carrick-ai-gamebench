#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  access,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  aggregateAttempts,
  createReleaseLock,
  findRepositoryRoot,
  listTasks,
  loadTask,
  ReleaseLockSchema,
  RunManifestSchema,
  ScoreResultSchema,
  SeriesManifestSchema,
  verifyEvidenceManifest,
  writeEvidenceManifest,
  writeJson,
  type JsonObject,
  type RunManifest,
} from "@carrick/gamebench-core";
import {
  FilesystemArtifactStore,
  publishSeries,
  verifyResultsRepository,
} from "@carrick/gamebench-publisher";
import { evaluateSubmission } from "./evaluate.js";
import { commandExists } from "./process.js";
import { serveReviewer } from "./reviewer-server.js";
import { runTask, type RunOptions } from "./runner.js";
import {
  prepareReproducibleRun,
  verifyAndReproduceRun,
} from "./verification.js";

const USAGE = `
Carrick AI GameBench (cagb)

Usage:
  cagb doctor
  cagb list
  cagb validate-task [task-id | --all]
  cagb release-lock [--write]
  cagb run --task <id> --agent-command <command> --agent-id <id> [options]
  cagb evaluate --run <run-dir>
  cagb aggregate (--series <series-dir> | --input <runs-dir>) [--output result.json]
  cagb verify-run --run <run-dir> --verifier-id <id> --image-digest <sha256:...>
  cagb publish --series <series-dir> --tier <experimental|official>
  cagb verify-publication [--results results] [--objects .gamebench]
  cagb verify --run <run-dir>  Legacy evidence-only verification
  cagb review --runs <runs-dir> [--port 4317]

Run options:
  --agent-version <version>   Default: unknown
  --model <model>             Default: unknown
  --model-params <json>       Score-relevant model parameters
  --harness <name>            Default: shell
  --lang <en|zh>              Default: en
  --repeat <n>                Local default: 1
  --official                  Force three fresh attempts
  --output <directory>        Default: runs
  --series <ulid>             Continue an existing compatible series
  --trajectory <path>         Agent trajectory path inside its workspace
`;

function fail(message: string): never {
  throw new Error(message);
}

async function benchmarkVersion(repositoryRoot: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof packageJson.version === "string"
    ? packageJson.version
    : fail("package.json must declare a benchmark version");
}

function parseRunOptions(args: string[]): ReturnType<typeof parseArgs>["values"] {
  return parseArgs({
    args,
    strict: true,
    options: {
      task: { type: "string" },
      "agent-command": { type: "string" },
      "agent-id": { type: "string" },
      "agent-version": { type: "string", default: "unknown" },
      model: { type: "string", default: "unknown" },
      "model-params": { type: "string", default: "{}" },
      harness: { type: "string", default: "shell" },
      lang: { type: "string", default: "en" },
      repeat: { type: "string", default: "1" },
      official: { type: "boolean", default: false },
      output: { type: "string", default: "runs" },
      series: { type: "string" },
      trajectory: { type: "string" },
    },
  }).values;
}

async function commandDoctor(repositoryRoot: string): Promise<void> {
  const evaluatorContainer =
    process.env.CAGB_EVALUATOR_CONTAINER === "1";
  const checks = [
    { name: "Node.js >=22.12", ok: Number(process.versions.node.split(".")[0]) >= 22 },
    { name: "pnpm", ok: commandExists("pnpm") },
    {
      name: evaluatorContainer ? "Evaluator container" : "Docker",
      ok: evaluatorContainer || commandExists("docker"),
    },
    { name: "tar", ok: commandExists("tar") },
    { name: "zstd", ok: commandExists("zstd") },
  ];
  try {
    await access(chromium.executablePath());
    checks.push({ name: "Playwright Chromium", ok: true });
  } catch {
    checks.push({ name: "Playwright Chromium", ok: false });
  }
  try {
    const tasks = await listTasks(repositoryRoot);
    checks.push({ name: `Task catalog (${tasks.length})`, ok: tasks.length > 0 });
  } catch {
    checks.push({ name: "Task catalog", ok: false });
  }

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
  }
  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

async function commandList(repositoryRoot: string): Promise<void> {
  const tasks = await listTasks(repositoryRoot);
  console.log("TRACK       LEVEL  TASK ID                                  TITLE");
  for (const task of tasks) {
    console.log(
      `${task.manifest.track.padEnd(11)} ${String(task.manifest.level).padEnd(6)} ${task.manifest.id.padEnd(40)} ${task.manifest.title.en}`,
    );
  }
}

async function commandValidate(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { all: { type: "boolean", default: false } },
  });
  if (parsed.values.all) {
    const tasks = await listTasks(repositoryRoot);
    console.log(`Validated ${tasks.length} tasks.`);
    return;
  }
  const id = parsed.positionals[0] ?? fail("validate-task requires a task ID or --all");
  const task = await loadTask(id, repositoryRoot);
  console.log(`${task.manifest.id} is valid (${task.hash}).`);
}

async function commandReleaseLock(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: { write: { type: "boolean", default: false } },
  }).values;
  const version = await benchmarkVersion(repositoryRoot);
  const lockPath = path.join(
    repositoryRoot,
    "benchmark",
    "releases",
    `${version}.json`,
  );
  const expected = createReleaseLock(
    version,
    await listTasks(repositoryRoot),
  );

  if (values.write) {
    await writeJson(lockPath, expected);
    console.log(
      `Wrote ${path.relative(repositoryRoot, lockPath)} (${expected.task_count} tasks).`,
    );
    return;
  }

  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    fail(
      `Cannot read ${path.relative(repositoryRoot, lockPath)}: ${
        error instanceof Error ? error.message : String(error)
      }. Run cagb release-lock --write after intentionally versioning the catalog.`,
    );
  }
  const parsed = ReleaseLockSchema.safeParse(existing);
  if (!parsed.success) {
    fail(`Invalid release lock: ${parsed.error.message}`);
  }
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
    fail(
      `Release lock does not match the current catalog. Bump the benchmark version and run cagb release-lock --write.`,
    );
  }
  console.log(
    `Verified ${path.relative(repositoryRoot, lockPath)} (${expected.task_count} tasks).`,
  );
}

function commonRunOptions(
  repositoryRoot: string,
  values: ReturnType<typeof parseRunOptions>,
): Omit<RunOptions, "task"> {
  const command =
    typeof values["agent-command"] === "string"
      ? values["agent-command"]
      : fail("--agent-command is required");
  const agentId =
    typeof values["agent-id"] === "string"
      ? values["agent-id"]
      : fail("--agent-id is required");
  const language = values.lang === "zh" ? "zh" : values.lang === "en" ? "en" : fail("--lang must be en or zh");
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) {
    fail("--repeat must be a positive integer");
  }
  let modelParameters: JsonObject;
  try {
    const parsed = JSON.parse(String(values["model-params"])) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("--model-params must be a JSON object");
    }
    modelParameters = parsed as JsonObject;
  } catch (error) {
    fail(
      `--model-params must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return {
    repositoryRoot,
    agentCommand: command,
    agentId,
    agentVersion: String(values["agent-version"]),
    model: String(values.model),
    modelParameters,
    harness: String(values.harness),
    language,
    outputRoot: path.resolve(repositoryRoot, String(values.output)),
    official: Boolean(values.official),
    repeat,
    ...(typeof values.series === "string"
      ? { seriesId: values.series }
      : {}),
    ...(typeof values.trajectory === "string"
      ? { trajectoryPath: values.trajectory }
      : {}),
  };
}

async function commandRun(repositoryRoot: string, args: string[]): Promise<void> {
  const values = parseRunOptions(args);
  const taskId =
    typeof values.task === "string" ? values.task : fail("--task is required");
  const task = await loadTask(taskId, repositoryRoot);
  const runs = await runTask({
    ...commonRunOptions(repositoryRoot, values),
    task,
  });
  for (const run of runs) {
    console.log(`${run.manifest.exit_reason?.toUpperCase()}  ${run.runDir}`);
  }
}

async function commandEvaluate(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: { run: { type: "string" } },
  }).values;
  const runDir = path.resolve(
    repositoryRoot,
    typeof values.run === "string" ? values.run : fail("--run is required"),
  );
  const parsedRun = RunManifestSchema.safeParse(
    JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8")),
  );
  if (!parsedRun.success) {
    fail(`Invalid run.json: ${parsedRun.error.message}`);
  }
  const run: RunManifest = parsedRun.data;
  const task = await loadTask(run.task_id, repositoryRoot);
  if (run.task_hash !== task.hash) {
    fail(`Run task hash does not match the current ${run.task_id} task`);
  }
  const result = await evaluateSubmission(task, {
    submissionDir: path.join(runDir, "workspace"),
    runDir,
    seed: run.seed,
  });
  await writeJson(path.join(runDir, "tests.json"), result.outcomes);
  await writeJson(path.join(runDir, "score.json"), result.score);
  await writeEvidenceManifest(runDir);
  console.log(`${result.score.percent.toFixed(2)}  ${run.task_id}`);
}

async function findFiles(root: string, name: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(root, entry.name);
      return entry.isDirectory()
        ? new Set(["node_modules", ".git", "dist", "playwright"]).has(entry.name)
          ? []
          : findFiles(absolute, name)
        : entry.isFile() && entry.name === name
          ? [absolute]
          : [];
    }),
  );
  return nested.flat();
}

async function commandAggregate(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: {
      input: { type: "string" },
      series: { type: "string" },
      output: { type: "string" },
    },
  }).values;
  if (
    (typeof values.input === "string") ===
    (typeof values.series === "string")
  ) {
    fail("aggregate requires exactly one of --input or --series");
  }
  const tasks = await listTasks(repositoryRoot);
  const byId = new Map(tasks.map((task) => [task.manifest.id, task]));
  const attempts = [];
  let scorePaths: string[];
  if (typeof values.series === "string") {
    const seriesDir = path.resolve(repositoryRoot, values.series);
    const series = SeriesManifestSchema.parse(
      JSON.parse(await readFile(path.join(seriesDir, "series.json"), "utf8")),
    );
    scorePaths = series.runs
      .filter((run) => run.included)
      .map((run) => path.join(seriesDir, run.run_id, "score.json"));
  } else {
    scorePaths = await findFiles(
      path.resolve(repositoryRoot, String(values.input)),
      "score.json",
    );
  }
  for (const scorePath of scorePaths) {
    const scoreResult = ScoreResultSchema.safeParse(
      JSON.parse(await readFile(scorePath, "utf8")),
    );
    if (!scoreResult.success) {
      continue;
    }
    const loadedTask = byId.get(scoreResult.data.task_id);
    if (loadedTask && scoreResult.data.task_hash === loadedTask.hash) {
      attempts.push({ task: loadedTask.manifest, score: scoreResult.data });
    }
  }
  const aggregate = aggregateAttempts(
    attempts,
    tasks.map((task) => task.manifest),
  );
  if (typeof values.output === "string") {
    await writeJson(path.resolve(repositoryRoot, values.output), aggregate);
  }
  console.log(JSON.stringify(aggregate, null, 2));
}

async function commandVerify(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: { run: { type: "string" } },
  }).values;
  const runDir = path.resolve(
    repositoryRoot,
    typeof values.run === "string" ? values.run : fail("--run is required"),
  );
  const result = await verifyEvidenceManifest(runDir);
  if (!result.valid) {
    fail(result.errors.join("\n"));
  }
  console.log(`Evidence manifest verified: ${runDir}`);
}

function parseSha256(value: unknown, option: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail(`${option} must be a sha256:<64 lowercase hex characters> digest`);
  }
  return value as `sha256:${string}`;
}

async function commandVerifyRun(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: {
      run: { type: "string" },
      "verifier-id": { type: "string" },
      "verifier-organization": { type: "string" },
      "image-digest": { type: "string" },
      "network-attestation": { type: "string", default: "unverified" },
    },
  }).values;
  const networkAttestation = values["network-attestation"];
  if (
    networkAttestation !== "not-required" &&
    networkAttestation !== "operator-attested-model-api-only" &&
    networkAttestation !== "unverified"
  ) {
    fail(
      "--network-attestation must be not-required, operator-attested-model-api-only, or unverified",
    );
  }
  const verification = await verifyAndReproduceRun({
    repositoryRoot,
    runDir: path.resolve(
      repositoryRoot,
      typeof values.run === "string" ? values.run : fail("--run is required"),
    ),
    verifierId:
      typeof values["verifier-id"] === "string"
        ? values["verifier-id"]
        : fail("--verifier-id is required"),
    ...(typeof values["verifier-organization"] === "string"
      ? { verifierOrganization: values["verifier-organization"] }
      : {}),
    evaluatorImageDigest: parseSha256(
      values["image-digest"] ?? process.env.CAGB_EVALUATOR_IMAGE_DIGEST,
      "--image-digest",
    ),
    networkAttestation,
  });
  console.log(
    `${verification.status.toUpperCase()}  ${verification.recomputed_score_hash}`,
  );
}

async function commandPublish(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: {
      series: { type: "string" },
      tier: { type: "string" },
      objects: { type: "string", default: ".gamebench" },
      results: { type: "string", default: "results" },
      "base-url": { type: "string", default: "/" },
      supersedes: { type: "string" },
    },
  }).values;
  if (values.tier !== "experimental" && values.tier !== "official") {
    fail("--tier must be experimental or official");
  }
  const store = new FilesystemArtifactStore(
    path.resolve(repositoryRoot, String(values.objects)),
    String(values["base-url"]),
  );
  const seriesDir = path.resolve(
    repositoryRoot,
    typeof values.series === "string"
      ? values.series
      : fail("--series is required"),
  );
  const series = SeriesManifestSchema.parse(
    JSON.parse(await readFile(path.join(seriesDir, "series.json"), "utf8")),
  );
  for (const run of series.runs) {
    const runDir = path.join(seriesDir, run.run_id);
    try {
      await access(path.join(runDir, "score.json"));
    } catch {
      continue;
    }
    await prepareReproducibleRun({ repositoryRoot, runDir });
  }
  const publication = await publishSeries({
    repositoryRoot,
    seriesDir,
    resultsRoot: path.resolve(repositoryRoot, String(values.results)),
    tier: values.tier,
    store,
    ...(typeof values.supersedes === "string"
      ? { supersedes: parseSha256(values.supersedes, "--supersedes") }
      : {}),
  });
  console.log(`${publication.tier.toUpperCase()}  ${publication.publication_id}`);
}

async function commandVerifyPublication(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: {
      results: { type: "string", default: "results" },
      objects: { type: "string" },
      "base-url": { type: "string", default: "/" },
    },
  }).values;
  const store = typeof values.objects === "string"
    ? new FilesystemArtifactStore(
        path.resolve(repositoryRoot, values.objects),
        String(values["base-url"]),
      )
    : undefined;
  const verified = await verifyResultsRepository(
    path.resolve(repositoryRoot, String(values.results)),
    store,
    repositoryRoot,
  );
  console.log(
    `Verified ${verified.publications} publications and ${verified.artifacts} artifact references.`,
  );
}

async function commandReview(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  const values = parseArgs({
    args,
    strict: true,
    options: {
      runs: { type: "string" },
      port: { type: "string", default: "4317" },
    },
  }).values;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail("--port must be between 1024 and 65535");
  }
  await serveReviewer({
    repositoryRoot,
    benchmarkVersion: await benchmarkVersion(repositoryRoot),
    runsRoot: path.resolve(
      repositoryRoot,
      typeof values.runs === "string" ? values.runs : fail("--runs is required"),
    ),
    port,
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE.trim());
    return;
  }
  const repositoryRoot = await findRepositoryRoot();
  if (command === "doctor") {
    await commandDoctor(repositoryRoot);
  } else if (command === "list") {
    await commandList(repositoryRoot);
  } else if (command === "validate-task") {
    await commandValidate(repositoryRoot, args);
  } else if (command === "release-lock") {
    await commandReleaseLock(repositoryRoot, args);
  } else if (command === "run") {
    await commandRun(repositoryRoot, args);
  } else if (command === "evaluate") {
    await commandEvaluate(repositoryRoot, args);
  } else if (command === "aggregate") {
    await commandAggregate(repositoryRoot, args);
  } else if (command === "verify-run") {
    await commandVerifyRun(repositoryRoot, args);
  } else if (command === "publish") {
    await commandPublish(repositoryRoot, args);
  } else if (command === "verify-publication") {
    await commandVerifyPublication(repositoryRoot, args);
  } else if (command === "verify") {
    await commandVerify(repositoryRoot, args);
  } else if (command === "review") {
    await commandReview(repositoryRoot, args);
  } else {
    fail(`Unknown command: ${command}\n${USAGE}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
