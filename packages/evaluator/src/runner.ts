import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  writeEvidenceManifest,
  writeJson,
  type LoadedTask,
  type RunManifest,
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
  harness: string;
  language: "en" | "zh";
  outputRoot: string;
  official: boolean;
  repeat: number;
  trajectoryPath?: string;
}

export interface CompletedRun {
  runDir: string;
  workspace: string;
  manifest: RunManifest;
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
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

async function hashArchive(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function runAttempt(
  options: RunOptions,
  attempt: number,
): Promise<CompletedRun> {
  const version = await benchmarkVersion(options.repositoryRoot);
  const now = new Date();
  const runId = [
    now.toISOString().replace(/[:.]/g, "-"),
    safeSegment(options.agentId),
    safeSegment(options.task.manifest.id),
    `a${attempt}`,
    randomUUID().slice(0, 8),
  ].join("_");
  const runDir = path.resolve(options.outputRoot, version, runId);
  const workspace = path.join(runDir, "workspace");
  await mkdir(runDir, { recursive: true });
  await copyWorkspace(
    resolveStarter(options.repositoryRoot, options.task),
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
    await cp(path.join(options.task.root, "reference"), path.join(referenceDir, "reference"), {
      recursive: true,
    });
    await cp(
      path.join(options.task.root, "references"),
      path.join(referenceDir, "references"),
      { recursive: true },
    );
  }

  const seed =
    options.official
      ? (OFFICIAL_SEEDS[attempt - 1] ?? OFFICIAL_SEEDS[0])
      : OFFICIAL_SEEDS[(attempt - 1) % OFFICIAL_SEEDS.length] ?? OFFICIAL_SEEDS[0];
  const startedAt = new Date();
  const baseManifest: RunManifest = {
    schema_version: 1,
    benchmark_version: version,
    run_id: runId,
    task_id: options.task.manifest.id,
    task_hash: options.task.hash,
    attempt,
    seed,
    official: options.official,
    verified: false,
    prompt_language: options.language,
    network_policy: options.task.manifest.network_policy,
    agent: {
      id: options.agentId,
      version: options.agentVersion,
      model: options.model,
      harness: options.harness,
    },
    environment: {
      platform: os.platform(),
      architecture: os.arch(),
      node: process.version,
    },
    started_at: startedAt.toISOString(),
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

  const installArgs = ["install", "--frozen-lockfile"];
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
    await copyFile(
      path.resolve(workspace, options.trajectoryPath),
      path.join(runDir, "agent-trajectory.jsonl"),
    );
  }

  const archivePath = path.join(runDir, "source.tar.zst");
  await archiveWorkspace(workspace, archivePath, path.join(runDir, "archive.log"));
  await writeFile(
    path.join(runDir, "source.sha256"),
    `${await hashArchive(archivePath)}  source.tar.zst\n`,
    "utf8",
  );

  let exitReason: RunManifest["exit_reason"];
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
  const finalManifest: RunManifest = {
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

export async function runTask(options: RunOptions): Promise<CompletedRun[]> {
  const attempts = Array.from(
    { length: options.official ? 3 : options.repeat },
    (_, index) => index + 1,
  );
  const completed: CompletedRun[] = [];
  for (const attempt of attempts) {
    completed.push(await runAttempt(options, attempt));
  }
  return completed;
}
