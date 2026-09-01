import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  LiteReleaseLockSchema,
  LiteResultIndexSchema,
  LiteSeriesResultSchema,
  LiteTaskResultSchema,
  ScoreResultSchema,
  TestOutcomeSchema,
  createUlid,
  loadTask,
  scoreTask,
  sha256File,
  summarizeLiteBuild,
  verifyEvidenceManifest,
  writeEvidenceManifest,
  writeJson,
  type JsonObject,
  type LiteReleaseLock,
  type LiteSeriesResult,
  type LiteTaskResult,
  type LoadedTask,
} from "@carrick/gamebench-core";
import { sealSubmissionWorkspace } from "./archive.js";
import { InfrastructureError, evaluateSubmissionArchive } from "./evaluate.js";
import {
  evaluatorEnvironment,
  findAvailablePort,
  runCommand,
  waitForUrl,
  type CommandResult,
} from "./process.js";
import {
  acquirePublicationIndexLock,
  ensurePublicationDirectory,
} from "./publication-lock.js";
import { prepareSubmissionWorkspace } from "./runner.js";

export interface LiteBenchOptions {
  repositoryRoot: string;
  outputRoot: string;
  agentCommand: string;
  agentId: string;
  agentVersion: string;
  model: string;
  modelParameters: JsonObject;
  harness: string;
  language: "en" | "zh";
  official: boolean;
  seriesId?: string;
  campaign?: {
    id: string;
    cell_id: string;
    plan_hash: `sha256:${string}`;
    execution_hash: `sha256:${string}`;
  };
}

function gitOutput(repositoryRoot: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function assertSecretFreePublication(value: unknown): void {
  const text = JSON.stringify(value);
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\b(?:OPENAI|ANTHROPIC|GOOGLE|DEEPSEEK|KIMI|MOONSHOT)_API_KEY\s*[:=]\s*["']?[^\s"']{8,}/i,
    /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("published result failed the credential-pattern scan");
  }
}

function processGroupExists(pid: number): boolean {
  if (process.platform === "win32") {
    return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopProcessTree(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid) {
    return;
  }
  if (process.platform === "win32") {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    return;
  }
  const pid = child.pid;
  if (!processGroupExists(pid)) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 5_000;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (processGroupExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group exited between checks.
    }
  }
}

export async function loadLiteRelease(
  repositoryRoot: string,
): Promise<{ release: LiteReleaseLock; releasePath: string; releaseHash: `sha256:${string}` }> {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must declare a benchmark version");
  }
  const releasePath = path.join(
    repositoryRoot,
    "benchmark",
    "releases",
    `${packageJson.version}.json`,
  );
  const release = LiteReleaseLockSchema.parse(
    JSON.parse(await readFile(releasePath, "utf8")),
  );
  if (release.benchmark_version !== packageJson.version) {
    throw new Error("release lock version does not match package.json");
  }
  return {
    release,
    releasePath,
    releaseHash: `sha256:${await sha256File(releasePath)}`,
  };
}

export async function runLitePreflight(repositoryRoot: string): Promise<void> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-preflight-"));
  const workspace = path.join(temporary, "workspace");
  let server: ChildProcess | undefined;
  try {
    await cp(
      path.join(repositoryRoot, "benchmark", "starters", "vite-ts"),
      workspace,
      {
        recursive: true,
        filter: (entry) => !new Set(["node_modules", "dist", ".git"]).has(path.basename(entry)),
      },
    );
    const install = await runCommand(
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-workspace"],
      {
        cwd: workspace,
        env: evaluatorEnvironment(),
        stdoutPath: path.join(temporary, "install.log"),
        stderrPath: path.join(temporary, "install.stderr.log"),
        timeoutMs: 120_000,
      },
    );
    if (install.exitCode !== 0) {
      throw new Error(`preflight dependency install failed with exit ${install.exitCode}`);
    }
    await rm(path.join(workspace, "node_modules"), { recursive: true, force: true });
    const offlineInstall = await runCommand(
      "pnpm",
      ["install", "--frozen-lockfile", "--offline", "--ignore-workspace"],
      {
        cwd: workspace,
        env: evaluatorEnvironment(),
        stdoutPath: path.join(temporary, "offline-install.log"),
        stderrPath: path.join(temporary, "offline-install.stderr.log"),
        timeoutMs: 120_000,
      },
    );
    if (offlineInstall.exitCode !== 0) {
      throw new Error(`preflight offline install failed with exit ${offlineInstall.exitCode}`);
    }
    const build = await runCommand("pnpm", ["build"], {
      cwd: workspace,
      env: evaluatorEnvironment(),
      stdoutPath: path.join(temporary, "build.log"),
      stderrPath: path.join(temporary, "build.stderr.log"),
      timeoutMs: 120_000,
    });
    if (build.exitCode !== 0) {
      throw new Error(`preflight build failed with exit ${build.exitCode}`);
    }
    const port = await findAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(
      "pnpm",
      ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      {
        cwd: workspace,
        env: evaluatorEnvironment(),
        detached: process.platform !== "win32",
        stdio: "ignore",
      },
    );
    await waitForUrl(baseUrl, 30_000);
    const browser = await chromium.launch({ headless: true, env: evaluatorEnvironment() });
    try {
      const page = await browser.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      const snapshot = await page.evaluate(async () => {
        const bridge = (window as typeof window & {
          __CARRICK_GAMEBENCH__?: {
            version: string;
            ready: Promise<void>;
            reset(input: { seed: number }): Promise<void>;
            advance(ms: number): Promise<void>;
            snapshot(): Promise<unknown>;
          };
        }).__CARRICK_GAMEBENCH__;
        if (!bridge || bridge.version !== "1") {
          throw new Error("starter bridge v1 is unavailable");
        }
        await bridge.ready;
        await bridge.reset({ seed: 104729 });
        await bridge.advance(0);
        return await bridge.snapshot();
      });
      const record = snapshot as Record<string, unknown> | null;
      if (
        !record ||
        record.seed !== 104729 ||
        !["menu", "running", "paused", "won", "lost"].includes(String(record.status)) ||
        typeof record.tick !== "number" ||
        !Number.isInteger(record.tick) ||
        !record.state ||
        typeof record.state !== "object" ||
        !Array.isArray(record.events)
      ) {
        throw new Error("preflight bridge snapshot is invalid");
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopProcessTree(server);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function runAgent(
  options: LiteBenchOptions,
  task: LoadedTask,
  workspace: string,
  taskDir: string,
  promptPath: string,
  stateSchemaPath: string,
): Promise<{ result: CommandResult; startedAt: Date; finishedAt: Date }> {
  const preparation = await runCommand(
    "pnpm",
    ["install", "--frozen-lockfile", "--ignore-workspace"],
    {
      cwd: workspace,
      env: evaluatorEnvironment(),
      stdoutPath: path.join(taskDir, "prepare.log"),
      stderrPath: path.join(taskDir, "prepare.stderr.log"),
      timeoutMs: 120_000,
    },
  );
  if (preparation.exitCode !== 0) {
    throw new Error(`workspace preparation failed with exit ${preparation.exitCode}`);
  }
  const startedAt = new Date();
  const deadline = new Date(
    startedAt.getTime() + task.manifest.budget_seconds * 1_000,
  ).toISOString();
  const result = await runCommand("bash", ["-lc", options.agentCommand], {
    cwd: workspace,
    env: {
      ...evaluatorEnvironment(),
      CAGB_TASK_ID: task.manifest.id,
      CAGB_PROMPT_PATH: promptPath,
      CAGB_STATE_SCHEMA_PATH: stateSchemaPath,
      CAGB_PUBLIC_TESTS_PATH: path.join(workspace, "gamebench", "public-tests.json"),
      CAGB_TASK_MANIFEST_PATH: path.join(workspace, "gamebench", "task.yml"),
      CAGB_NETWORK_POLICY: task.manifest.network_policy,
      CAGB_DEADLINE_AT: deadline,
    },
    stdoutPath: path.join(taskDir, "agent.log"),
    stderrPath: path.join(taskDir, "agent.stderr.log"),
    timeoutMs: task.manifest.budget_seconds * 1_000,
  });
  return { result, startedAt, finishedAt: new Date() };
}

async function runLiteTask(
  options: LiteBenchOptions,
  task: LoadedTask,
  runDir: string,
  seed: LiteReleaseLock["evaluation_seed"],
): Promise<LiteTaskResult> {
  const safeTaskId = task.manifest.id.replaceAll("/", "-");
  const taskDir = path.join(runDir, "tasks", safeTaskId);
  await mkdir(taskDir, { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cagb-develop-"));
  const workspace = path.join(temporary, "workspace");
  try {
    const stateSchemaPath = await prepareSubmissionWorkspace(
      options.repositoryRoot,
      task,
      workspace,
    );
    const promptPath = path.join(taskDir, "prompt.md");
    await copyFile(path.join(task.root, task.manifest.prompt[options.language]), promptPath);
    const agent = await runAgent(
      options,
      task,
      workspace,
      taskDir,
      promptPath,
      stateSchemaPath,
    );
    const sourceArchive = path.join(taskDir, "source.tar.zst");
    const sealed = await sealSubmissionWorkspace(
      workspace,
      sourceArchive,
      path.join(taskDir, "archive.log"),
    );
    await writeFile(
      path.join(taskDir, "source.sha256"),
      `${await sha256File(sourceArchive)}  source.tar.zst\n`,
      "utf8",
    );
    const exitReason = agent.result.timedOut
      ? "timeout-delivery" as const
      : agent.result.exitCode === 0
        ? "completed" as const
        : "agent-error" as const;

    let evaluation: LiteTaskResult["evaluation"] = {
      seed,
      status: "not-run",
    };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await evaluateSubmissionArchive(task, {
          archivePath: sourceArchive,
          sourceSnapshotHash: sealed.sourceSnapshotHash,
          evaluationDir: taskDir,
          seed,
        });
        await writeJson(path.join(taskDir, "tests.json"), result.outcomes);
        await writeJson(path.join(taskDir, "score.json"), result.score);
        evaluation = { seed, status: "scored", score: result.score };
        break;
      } catch (error) {
        if (!(error instanceof InfrastructureError)) {
          throw error;
        }
        const message = error.message;
        await writeJson(
          path.join(taskDir, `infrastructure-attempt-${attempt}.json`),
          { attempt, message },
        );
        evaluation = { seed, status: "infrastructure-error", message };
      }
    }
    if (evaluation.status === "infrastructure-error") {
      await writeJson(path.join(taskDir, "infrastructure-error.json"), {
        message: evaluation.message,
      });
    }

    const agentRecord: LiteTaskResult["agent"] = {
      invocation: 1,
      started_at: agent.startedAt.toISOString(),
      finished_at: agent.finishedAt.toISOString(),
      wall_time_ms: agent.finishedAt.getTime() - agent.startedAt.getTime(),
      exit_reason: exitReason,
    };
    await writeJson(path.join(taskDir, "agent.json"), agentRecord);
    await writeEvidenceManifest(taskDir);
    const artifactManifestHash = `sha256:${await sha256File(
      path.join(taskDir, "MANIFEST.sha256"),
    )}` as const;
    return LiteTaskResultSchema.parse({
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash,
      source_hash: sealed.sourceSnapshotHash,
      agent: agentRecord,
      evaluation,
      artifact_manifest_hash: artifactManifestHash,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function createSeriesRunDirectory(
  outputRoot: string,
  seriesId: string,
): Promise<string> {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(seriesId)) {
    throw new Error("seriesId must be a canonical ULID");
  }
  const runDir = path.resolve(outputRoot, seriesId);
  await mkdir(outputRoot, { recursive: true });
  for (const directory of [path.dirname(outputRoot), outputRoot]) {
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`run root component is not a real directory: ${directory}`);
    }
  }
  try {
    await mkdir(runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`series directory already exists and may not be reused: ${seriesId}`);
    }
    throw error;
  }
  return runDir;
}

export async function runLiteBenchmark(
  options: LiteBenchOptions,
  tasks: LoadedTask[],
): Promise<{ runDir: string; result: LiteSeriesResult }> {
  const { release, releaseHash } = await loadLiteRelease(options.repositoryRoot);
  const byId = new Map(tasks.map((task) => [task.manifest.id, task]));
  const selected = release.tasks.map((reference) => {
    const task = byId.get(reference.id);
    if (!task || task.hash !== reference.hash || task.manifest.version !== reference.version) {
      throw new Error(`release task does not match the active catalog: ${reference.id}`);
    }
    return task;
  });
  const initialStatus = gitOutput(options.repositoryRoot, ["status", "--porcelain"]);
  const initialCommit = gitOutput(options.repositoryRoot, ["rev-parse", "HEAD"]);
  if (options.official && (initialStatus === undefined || !initialCommit)) {
    throw new Error("Official benchmark requires an accessible Git repository");
  }
  const sourceTreeClean = initialStatus === "";
  if (options.official && !sourceTreeClean) {
    throw new Error("Official benchmark requires a clean Git working tree");
  }
  await runLitePreflight(options.repositoryRoot);

  const startedAt = new Date();
  const seriesId = options.seriesId ?? createUlid();
  const runDir = await createSeriesRunDirectory(options.outputRoot, seriesId);
  const markerBase = {
    schema_version: 1,
    benchmark_version: release.benchmark_version,
    series_id: seriesId,
    ...(options.campaign
      ? {
          campaign_id: options.campaign.id,
          plan_hash: options.campaign.plan_hash,
          cell_id: options.campaign.cell_id,
        }
      : {}),
  };
  await writeJson(path.join(runDir, ".series.json"), {
    ...markerBase,
    status: "prepared",
    started_at: startedAt.toISOString(),
  });
  await mkdir(path.join(runDir, "tasks"));

  try {
    await writeJson(path.join(runDir, ".series.json"), {
      ...markerBase,
      status: "running",
      started_at: startedAt.toISOString(),
    });
    const taskResults: LiteTaskResult[] = [];
    const taskErrors: Array<{ task_id: string; message: string }> = [];
    for (const task of selected) {
      try {
        taskResults.push(
          await runLiteTask(options, task, runDir, release.evaluation_seed),
        );
      } catch (error) {
        const failure = {
          task_id: task.manifest.id,
          message: error instanceof Error ? error.message : String(error),
        };
        taskErrors.push(failure);
        const taskDir = path.join(
          runDir,
          "tasks",
          task.manifest.id.replaceAll("/", "-"),
        );
        await mkdir(taskDir, { recursive: true });
        await writeJson(path.join(taskDir, "task-error.json"), failure);
      }
    }
    if (taskErrors.length > 0) {
      await writeJson(path.join(runDir, "benchmark-error.json"), {
        schema_version: 1,
        series_id: seriesId,
        completed_tasks: taskResults,
        errors: taskErrors,
      });
      throw new Error(
        `benchmark could not produce a complete result: ${taskErrors.map((error) => error.task_id).join(", ")}`,
      );
    }
    const buildSummary = summarizeLiteBuild(taskResults);
    if (buildSummary.score === undefined) {
      await writeJson(path.join(runDir, "benchmark-error.json"), {
        schema_version: 1,
        series_id: seriesId,
        completed_tasks: taskResults,
        errors: [{ message: "one or more evaluations exhausted infrastructure retries" }],
      });
      throw new Error("benchmark could not produce a complete scored series");
    }
    const finishedAt = new Date();
    const finalStatus = gitOutput(options.repositoryRoot, ["status", "--porcelain"]);
    const finalCommit = gitOutput(options.repositoryRoot, ["rev-parse", "HEAD"]);
    if (
      options.official &&
      (finalStatus !== "" || !initialCommit || finalCommit !== initialCommit)
    ) {
      throw new Error("Git commit or working tree changed during the Official benchmark");
    }
    const gitCommit = initialCommit ?? finalCommit;
    const result = LiteSeriesResultSchema.parse({
      schema_version: 2,
      benchmark: "carrick-ai-gamebench",
      benchmark_version: release.benchmark_version,
      release_hash: releaseHash,
      series_id: seriesId,
      git_commit: gitCommit && /^[a-f0-9]{40}$/.test(gitCommit) ? gitCommit : "unknown",
      source_tree_clean: sourceTreeClean,
      profile: options.official ? "official" : "local",
      configuration: {
        agent: {
          id: options.agentId,
          version: options.agentVersion,
          model: options.model,
          harness: options.harness,
          parameters: options.modelParameters,
        },
        prompt_language: options.language,
      },
      campaign: options.campaign,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      tasks: taskResults,
      build: buildSummary,
    });
    await writeJson(path.join(runDir, "result.json"), result);
    await writeJson(path.join(runDir, ".series.json"), {
      ...markerBase,
      status: "complete",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    });
    return { runDir, result };
  } catch (error) {
    await writeJson(path.join(runDir, ".series.json"), {
      ...markerBase,
      status: "aborted",
      started_at: startedAt.toISOString(),
      aborted_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function checkLiteBenchmark(
  repositoryRoot: string,
  runDir: string,
  requireOfficial = false,
): Promise<LiteSeriesResult> {
  const { release, releaseHash } = await loadLiteRelease(repositoryRoot);
  const result = LiteSeriesResultSchema.parse(
    JSON.parse(await readFile(path.join(runDir, "result.json"), "utf8")),
  );
  if (result.benchmark_version !== release.benchmark_version || result.release_hash !== releaseHash) {
    throw new Error("result does not match the current release lock");
  }
  if (result.tasks.length !== release.tasks.length) {
    throw new Error("result task count does not match the release");
  }
  const byId = new Map(result.tasks.map((task) => [task.task_id, task]));
  for (const reference of release.tasks) {
    const task = byId.get(reference.id);
    if (!task || task.task_hash !== reference.hash || task.task_version !== reference.version) {
      throw new Error(`missing or mismatched release task: ${reference.id}`);
    }
    if (task.evaluation.seed !== release.evaluation_seed) {
      throw new Error(`wrong evaluation seed for ${reference.id}`);
    }
    const taskDir = path.join(runDir, "tasks", reference.id.replaceAll("/", "-"));
    const recordedAgent = JSON.parse(
      await readFile(path.join(taskDir, "agent.json"), "utf8"),
    ) as unknown;
    if (JSON.stringify(recordedAgent) !== JSON.stringify(task.agent)) {
      throw new Error(`${reference.id}: Agent invocation record mismatch`);
    }
    const sourceHash = `sha256:${await sha256File(path.join(taskDir, "source.tar.zst"))}`;
    if (sourceHash !== task.source_hash) {
      throw new Error(`${reference.id}: source archive hash mismatch`);
    }
    if (task.evaluation.score) {
      const evidenceScore = ScoreResultSchema.parse(
        JSON.parse(await readFile(path.join(taskDir, "score.json"), "utf8")),
      );
      if (JSON.stringify(evidenceScore) !== JSON.stringify(task.evaluation.score)) {
        throw new Error(`${reference.id}: result score differs from evaluator evidence`);
      }
      const outcomes = TestOutcomeSchema.array().parse(
        JSON.parse(await readFile(path.join(taskDir, "tests.json"), "utf8")),
      );
      const loadedTask = await loadTask(reference.id, repositoryRoot);
      const recomputed = scoreTask(loadedTask.manifest, loadedTask.hash, outcomes);
      if (JSON.stringify(recomputed) !== JSON.stringify(evidenceScore)) {
        throw new Error(`${reference.id}: score arithmetic or test evidence was modified`);
      }
    }
    const evidence = await verifyEvidenceManifest(taskDir);
    if (!evidence.valid) {
      throw new Error(`${reference.id}: ${evidence.errors.join("; ")}`);
    }
    const manifestHash = `sha256:${await sha256File(path.join(taskDir, "MANIFEST.sha256"))}`;
    if (manifestHash !== task.artifact_manifest_hash) {
      throw new Error(`${reference.id}: artifact manifest hash mismatch`);
    }
  }
  if (requireOfficial) {
    if (
      result.profile !== "official" ||
      !result.source_tree_clean ||
      result.git_commit === "unknown"
    ) {
      throw new Error("publish requires an Official clean-tree result with a Git commit");
    }
    if (gitOutput(repositoryRoot, ["status", "--porcelain"]) !== "") {
      throw new Error("publish requires a clean Git tree");
    }
    if (
      gitOutput(repositoryRoot, ["cat-file", "-e", `${result.git_commit}^{commit}`]) === undefined
    ) {
      throw new Error("the benchmark Git commit is not available in this repository");
    }
    if (result.build.completed !== result.build.required || result.build.score === undefined) {
      throw new Error("publish requires complete scored coverage");
    }
  }
  return result;
}

export async function checkLitePublishedResults(
  repositoryRoot: string,
): Promise<number> {
  const indexPath = path.join(repositoryRoot, "results", "lite", "index.json");
  const index = LiteResultIndexSchema.parse(
    JSON.parse(await readFile(indexPath, "utf8")),
  );
  const { release, releaseHash } = await loadLiteRelease(repositoryRoot);
  for (const entry of index.results) {
    const result = LiteSeriesResultSchema.parse(
      JSON.parse(await readFile(path.join(repositoryRoot, entry.path), "utf8")),
    );
    if (
      result.series_id !== entry.series_id ||
      result.benchmark_version !== entry.benchmark_version ||
      result.release_hash !== releaseHash ||
      result.profile !== "official" ||
      !result.source_tree_clean ||
      result.git_commit === "unknown" ||
      result.build.completed !== 4 ||
      result.build.required !== 4 ||
      result.build.score === undefined
    ) {
      throw new Error(`invalid Official lightweight publication: ${entry.series_id}`);
    }
    for (const reference of release.tasks) {
      const task = result.tasks.find((row) => row.task_id === reference.id);
      if (
        !task ||
        task.task_version !== reference.version ||
        task.task_hash !== reference.hash ||
        !task.evaluation.score
      ) {
        throw new Error(`published task does not match release: ${reference.id}`);
      }
      const loadedTask = await loadTask(reference.id, repositoryRoot);
      const outcomes = task.evaluation.score.tests.map((test) => ({
        id: test.id,
        passed: test.passed,
        duration_ms: test.duration_ms,
        ...(test.message ? { message: test.message } : {}),
        artifacts: test.artifacts,
      }));
      if (
        JSON.stringify(scoreTask(loadedTask.manifest, loadedTask.hash, outcomes)) !==
        JSON.stringify(task.evaluation.score)
      ) {
        throw new Error(`published score arithmetic was modified: ${reference.id}`);
      }
    }
  }
  return index.results.length;
}

export async function publishLiteBenchmark(
  repositoryRoot: string,
  runDir: string,
): Promise<string> {
  const result = await checkLiteBenchmark(repositoryRoot, runDir, true);
  if (result.campaign) {
    throw new Error("campaign-affiliated results must be published as one campaign batch");
  }
  assertSecretFreePublication(result);
  const resultDir = await ensurePublicationDirectory(
    repositoryRoot,
    result.benchmark_version,
  );
  const destination = path.join(resultDir, `${result.series_id}.json`);
  const indexPath = path.join(repositoryRoot, "results", "lite", "index.json");
  const releaseLock = await acquirePublicationIndexLock(`${indexPath}.lock`);
  const temporaryIndexPath = `${indexPath}.tmp-${process.pid}`;
  let copied = false;
  try {
    if (await pathExists(destination)) {
      throw new Error(`published result already exists: ${destination}`);
    }
    const index = LiteResultIndexSchema.parse(
      JSON.parse(await readFile(indexPath, "utf8")),
    );
    const updatedIndex = LiteResultIndexSchema.parse({
      ...index,
      results: [
        ...index.results,
        {
          benchmark_version: result.benchmark_version,
          series_id: result.series_id,
          path: path.relative(repositoryRoot, destination).split(path.sep).join("/"),
        },
      ],
    });
    await writeJson(temporaryIndexPath, updatedIndex);
    await copyFile(path.join(runDir, "result.json"), destination);
    copied = true;
    await rename(temporaryIndexPath, indexPath);
    return destination;
  } catch (error) {
    await Promise.all([
      ...(copied ? [rm(destination, { force: true })] : []),
      rm(temporaryIndexPath, { force: true }),
    ]);
    throw error;
  } finally {
    await releaseLock();
  }
}
