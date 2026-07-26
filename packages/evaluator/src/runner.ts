import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SeriesManifestSchema,
  createUlid,
  sha256Canonical,
  sha256File,
  writeEvidenceManifest,
  writeJson,
  type JsonObject,
  type JsonValue,
  type LoadedTask,
  type RunEnvironmentV2,
  type RunManifestV2,
  type SeriesManifest,
} from "@carrick/gamebench-core";
import { evaluateSubmission } from "./evaluate.js";
import { runCommand, type CommandResult } from "./process.js";

const OFFICIAL_SEEDS = [104_729, 130_363, 155_921] as const;

export interface RunOptions {
  repositoryRoot: string;
  task: LoadedTask;
  agentCommand: string;
  agentId: string;
  agentVersion: string;
  model: string;
  modelParameters: JsonObject;
  harness: string;
  language: "en" | "zh";
  outputRoot: string;
  official: boolean;
  repeat: number;
  seriesId?: string;
  trajectoryPath?: string;
}

export interface CompletedRun {
  runDir: string;
  workspace: string;
  manifest: RunManifestV2;
}

interface SeriesContext {
  seriesDir: string;
  manifest: SeriesManifest;
}

async function benchmarkVersion(repositoryRoot: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version?: string };
  return packageJson.version ?? "unknown";
}

function resolveStarter(repositoryRoot: string, task: LoadedTask): string {
  return path.join(
    repositoryRoot,
    "benchmark",
    "starters",
    task.manifest.starter,
  );
}

async function archiveWorkspace(
  workspace: string,
  outputPath: string,
  logPath: string,
): Promise<void> {
  const result = await runCommand(
    "tar",
    [
      "--zstd",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--pax-option=delete=atime,delete=ctime",
      "--exclude=./node_modules",
      "--exclude=./dist",
      "--exclude=./.git",
      "-cf",
      outputPath,
      "-C",
      workspace,
      ".",
    ],
    {
      cwd: workspace,
      stdoutPath: logPath,
      stderrPath: logPath,
      append: true,
      timeoutMs: 120_000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`could not archive workspace; tar exited ${result.exitCode}`);
  }
}

async function copyWorkspace(source: string, destination: string): Promise<void> {
  const ignored = new Set(["node_modules", "dist", ".git"]);
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (entry) => !ignored.has(path.basename(entry)),
  });
}

export async function prepareSubmissionWorkspace(
  repositoryRoot: string,
  task: LoadedTask,
  workspace: string,
): Promise<string> {
  await copyWorkspace(resolveStarter(repositoryRoot, task), workspace);
  const schemaRelative = task.manifest.bridge.state_schema;
  const schemaDestination = path.resolve(workspace, schemaRelative);
  const workspaceRoot = path.resolve(workspace);
  if (!schemaDestination.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`state schema escapes submission workspace: ${schemaRelative}`);
  }
  await mkdir(path.dirname(schemaDestination), { recursive: true });
  await copyFile(path.resolve(task.root, schemaRelative), schemaDestination);
  const publicTaskDir = path.join(workspace, "gamebench");
  await mkdir(publicTaskDir, { recursive: true });
  await Promise.all([
    copyFile(
      path.resolve(task.root, task.manifest.test_suite),
      path.join(publicTaskDir, "public-tests.json"),
    ),
    copyFile(
      path.resolve(task.root, "task.yml"),
      path.join(publicTaskDir, "task.yml"),
    ),
  ]);
  return schemaDestination;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function gitOutput(repositoryRoot: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function evaluatorImageDigest(): `sha256:${string}` | undefined {
  const value = process.env.CAGB_EVALUATOR_IMAGE_DIGEST;
  if (!value) {
    return undefined;
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error("CAGB_EVALUATOR_IMAGE_DIGEST must be a sha256 digest");
  }
  return value as `sha256:${string}`;
}

async function workingTreeState(
  repositoryRoot: string,
): Promise<{ dirty: boolean; hash?: `sha256:${string}` }> {
  const status = gitOutput(repositoryRoot, ["status", "--porcelain"]) ?? "";
  if (!status) {
    return { dirty: false };
  }
  const diff = gitOutput(repositoryRoot, ["diff", "--binary", "HEAD", "--"]) ?? "";
  const untrackedOutput =
    gitOutput(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]) ?? "";
  const untracked = [];
  for (const relative of untrackedOutput.split("\0").filter(Boolean).sort()) {
    const absolute = path.resolve(repositoryRoot, relative);
    if (!absolute.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) {
      throw new Error(`untracked path escapes repository: ${relative}`);
    }
    untracked.push({
      path: relative.split(path.sep).join("/"),
      sha256: `sha256:${await sha256File(absolute)}`,
    });
  }
  return {
    dirty: true,
    hash: sha256Canonical({ status, diff, untracked }),
  };
}

async function createSeriesContext(options: RunOptions): Promise<SeriesContext> {
  const version = await benchmarkVersion(options.repositoryRoot);
  const releasePath = path.join(
    options.repositoryRoot,
    "benchmark",
    "releases",
    `${version}.json`,
  );
  if (!(await pathExists(releasePath))) {
    throw new Error(
      `benchmark release lock is missing: benchmark/releases/${version}.json`,
    );
  }
  const releaseHash = `sha256:${await sha256File(releasePath)}` as const;
  const gitCommit = gitOutput(options.repositoryRoot, ["rev-parse", "HEAD"]);
  const workingTree = await workingTreeState(options.repositoryRoot);
  const imageDigest = evaluatorImageDigest();
  const environment: RunEnvironmentV2 = {
    platform: os.platform(),
    architecture: os.arch(),
    node: process.version,
    runner_protocol: "2",
    git_commit: gitCommit && /^[a-f0-9]{40}$/.test(gitCommit)
      ? gitCommit
      : "unknown",
    source_tree_dirty: workingTree.dirty,
    ...(workingTree.hash ? { working_tree_hash: workingTree.hash } : {}),
    ...(imageDigest ? { evaluator_image_digest: imageDigest } : {}),
  };
  const agent = {
    id: options.agentId,
    version: options.agentVersion,
    model: options.model,
    harness: options.harness,
    parameters: options.modelParameters,
  };
  const executionProfile = options.official
    ? "official-candidate" as const
    : "local" as const;
  const configurationIdentity = {
    benchmark_version: version,
    benchmark_release_hash: releaseHash,
    agent,
    prompt_language: options.language,
    execution_profile: executionProfile,
    environment,
  };
  const configurationId = sha256Canonical(
    JSON.parse(JSON.stringify(configurationIdentity)) as JsonValue,
  );
  const seriesId = options.seriesId ?? createUlid();
  const seriesDir = path.resolve(options.outputRoot, version, seriesId);
  const seriesPath = path.join(seriesDir, "series.json");

  if (await pathExists(seriesPath)) {
    const existing = SeriesManifestSchema.parse(
      JSON.parse(await readFile(seriesPath, "utf8")),
    );
    if (
      existing.benchmark_version !== version ||
      existing.benchmark_release_hash !== releaseHash ||
      existing.configuration_id !== configurationId
    ) {
      throw new Error(
        `series ${seriesId} belongs to a different benchmark or configuration`,
      );
    }
    return { seriesDir, manifest: existing };
  }

  const manifest = SeriesManifestSchema.parse({
    schema_version: 1,
    series_id: seriesId,
    benchmark_version: version,
    benchmark_release_hash: releaseHash,
    git_commit: environment.git_commit,
    configuration_id: configurationId,
    configuration: {
      agent,
      prompt_language: options.language,
      execution_profile: executionProfile,
      environment,
    },
    created_at: new Date().toISOString(),
    runs: [],
  });
  await writeJson(seriesPath, manifest);
  return { seriesDir, manifest };
}

async function runAttempt(
  options: RunOptions,
  series: SeriesContext,
  attempt: number,
  seed: number,
): Promise<CompletedRun> {
  const runId = createUlid();
  const runDir = path.join(series.seriesDir, runId);
  const workspace = path.join(runDir, "workspace");
  await mkdir(runDir, { recursive: true });
  const stateSchemaPath = await prepareSubmissionWorkspace(
    options.repositoryRoot,
    options.task,
    workspace,
  );

  const promptSource = path.join(
    options.task.root,
    options.task.manifest.prompt[options.language],
  );
  const promptPath = path.join(runDir, "prompt.md");
  await copyFile(promptSource, promptPath);
  let referenceDir: string | undefined;
  if (options.task.manifest.reference) {
    referenceDir = path.join(runDir, "reference-material");
    await mkdir(referenceDir, { recursive: true });
    await cp(
      path.join(options.task.root, "reference"),
      path.join(referenceDir, "reference"),
      { recursive: true },
    );
    await cp(
      path.join(options.task.root, "references"),
      path.join(referenceDir, "references"),
      { recursive: true },
    );
  }

  const startedAt = new Date();
  const inputFingerprint = sha256Canonical({
    configuration_id: series.manifest.configuration_id,
    task_id: options.task.manifest.id,
    task_version: options.task.manifest.version,
    task_hash: options.task.hash,
    seed,
    prompt_language: options.language,
    budget_seconds: options.task.manifest.budget_seconds,
    network_policy: options.task.manifest.network_policy,
  });
  const baseManifest: RunManifestV2 = {
    schema_version: 2,
    benchmark_version: series.manifest.benchmark_version,
    benchmark_release_hash: series.manifest.benchmark_release_hash,
    series_id: series.manifest.series_id,
    run_id: runId,
    configuration_id: series.manifest.configuration_id,
    input_fingerprint: inputFingerprint,
    task_id: options.task.manifest.id,
    task_version: options.task.manifest.version,
    task_hash: options.task.hash,
    attempt,
    seed,
    execution_profile: series.manifest.configuration.execution_profile,
    prompt_language: options.language,
    network_policy: options.task.manifest.network_policy,
    agent: series.manifest.configuration.agent,
    environment: series.manifest.configuration.environment,
    started_at: startedAt.toISOString(),
    usage: { source: "not-reported" },
  };
  await writeJson(path.join(runDir, "run.json"), baseManifest);

  const trajectoryStart = {
    type: "shell-command",
    at: startedAt.toISOString(),
    command: options.agentCommand,
  };
  await writeFile(
    path.join(runDir, "trajectory.jsonl"),
    `${JSON.stringify(trajectoryStart)}\n`,
    "utf8",
  );

  const installArgs = ["install", "--frozen-lockfile", "--ignore-workspace"];
  if (options.task.manifest.network_policy !== "full") {
    installArgs.push("--offline");
  }
  const preparation = await runCommand("pnpm", installArgs, {
    cwd: workspace,
    stdoutPath: path.join(runDir, "prepare.log"),
    stderrPath: path.join(runDir, "prepare.stderr.log"),
    timeoutMs: 120_000,
  });

  let agentResult: CommandResult;
  if (preparation.exitCode !== 0) {
    const message = `workspace dependency preparation failed with exit ${preparation.exitCode}\n`;
    await Promise.all([
      writeFile(path.join(runDir, "stdout.log"), "", "utf8"),
      writeFile(path.join(runDir, "stderr.log"), message, "utf8"),
    ]);
    agentResult = {
      exitCode: preparation.exitCode,
      signal: preparation.signal,
      timedOut: preparation.timedOut,
      durationMs: preparation.durationMs,
    };
  } else {
    agentResult = await runCommand("bash", ["-lc", options.agentCommand], {
      cwd: workspace,
      env: {
        ...process.env,
        CAGB_TASK_ID: options.task.manifest.id,
        CAGB_PROMPT_PATH: promptPath,
        CAGB_STATE_SCHEMA_PATH: stateSchemaPath,
        CAGB_PUBLIC_TESTS_PATH: path.join(
          workspace,
          "gamebench",
          "public-tests.json",
        ),
        CAGB_TASK_MANIFEST_PATH: path.join(workspace, "gamebench", "task.yml"),
        CAGB_RUN_DIR: runDir,
        CAGB_SEED: String(seed),
        CAGB_NETWORK_POLICY: options.task.manifest.network_policy,
        ...(referenceDir ? { CAGB_REFERENCE_DIR: referenceDir } : {}),
        CAGB_DEADLINE_AT: new Date(
          startedAt.getTime() + options.task.manifest.budget_seconds * 1_000,
        ).toISOString(),
      },
      stdoutPath: path.join(runDir, "stdout.log"),
      stderrPath: path.join(runDir, "stderr.log"),
      timeoutMs: options.task.manifest.budget_seconds * 1_000,
    });
  }

  if (options.trajectoryPath) {
    const trajectorySource = path.resolve(workspace, options.trajectoryPath);
    if (!trajectorySource.startsWith(`${path.resolve(workspace)}${path.sep}`)) {
      throw new Error("trajectory path escapes the submission workspace");
    }
    await copyFile(trajectorySource, path.join(runDir, "agent-trajectory.jsonl"));
  }

  const archivePath = path.join(runDir, "source.tar.zst");
  await archiveWorkspace(workspace, archivePath, path.join(runDir, "archive.log"));
  await writeFile(
    path.join(runDir, "source.sha256"),
    `${await sha256File(archivePath)}  source.tar.zst\n`,
    "utf8",
  );

  let exitReason: RunManifestV2["exit_reason"];
  if (agentResult.timedOut) {
    exitReason = "timeout";
  } else if (agentResult.exitCode !== 0) {
    exitReason = "agent-error";
  } else {
    exitReason = "completed";
  }

  try {
    const evaluation = await evaluateSubmission(options.task, {
      submissionDir: workspace,
      runDir,
      seed,
    });
    await writeJson(path.join(runDir, "tests.json"), evaluation.outcomes);
    await writeJson(path.join(runDir, "score.json"), evaluation.score);
  } catch (error) {
    exitReason = "evaluation-error";
    await writeJson(path.join(runDir, "evaluation-error.json"), {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const finishedAt = new Date();
  const finalManifest: RunManifestV2 = {
    ...baseManifest,
    finished_at: finishedAt.toISOString(),
    exit_reason: exitReason,
  };
  await writeJson(path.join(runDir, "run.json"), finalManifest);
  await writeJson(path.join(runDir, "telemetry.json"), {
    schema_version: 1,
    wall_time_ms: finishedAt.getTime() - startedAt.getTime(),
    agent_time_ms: agentResult.durationMs,
    tokens: null,
    cost_usd: null,
    cost_source: "not-reported",
  });
  await writeFile(
    path.join(runDir, "trajectory.jsonl"),
    `${JSON.stringify(trajectoryStart)}\n${JSON.stringify({
      type: "shell-result",
      at: finishedAt.toISOString(),
      exit_code: agentResult.exitCode,
      signal: agentResult.signal,
      timed_out: agentResult.timedOut,
    })}\n`,
    "utf8",
  );
  await writeEvidenceManifest(runDir);
  return { runDir, workspace, manifest: finalManifest };
}

async function appendSeriesRun(
  series: SeriesContext,
  completed: CompletedRun,
): Promise<void> {
  const run = completed.manifest;
  const duplicate = series.manifest.runs.some(
    (existing) =>
      existing.included &&
      existing.task_id === run.task_id &&
      existing.seed === run.seed,
  );
  const hasScore = await pathExists(path.join(completed.runDir, "score.json"));
  const included = hasScore && !duplicate;
  series.manifest.runs.push({
    run_id: run.run_id,
    task_id: run.task_id,
    task_hash: run.task_hash,
    seed: run.seed,
    attempt: run.attempt,
    included,
    ...(!hasScore
      ? { exclusion_reason: "run did not produce a score" }
      : duplicate
        ? { exclusion_reason: "duplicate task and seed; earlier run retained" }
        : {}),
  });
  series.manifest = SeriesManifestSchema.parse(series.manifest);
  await writeJson(path.join(series.seriesDir, "series.json"), series.manifest);
}

export async function runTask(options: RunOptions): Promise<CompletedRun[]> {
  const series = await createSeriesContext(options);
  const existingAttempts = series.manifest.runs.filter(
    (run) => run.task_id === options.task.manifest.id,
  ).length;
  const count = options.official ? OFFICIAL_SEEDS.length : options.repeat;
  const completed: CompletedRun[] = [];
  for (let index = 0; index < count; index += 1) {
    const seed = options.official
      ? OFFICIAL_SEEDS[index] ?? OFFICIAL_SEEDS[0]
      : OFFICIAL_SEEDS[index % OFFICIAL_SEEDS.length] ?? OFFICIAL_SEEDS[0];
    const result = await runAttempt(
      options,
      series,
      existingAttempts + index + 1,
      seed,
    );
    completed.push(result);
    await appendSeriesRun(series, result);
  }
  return completed;
}
