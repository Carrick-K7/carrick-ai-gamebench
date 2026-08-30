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
  EvaluationResultSchema,
  ReleaseLockV3Schema,
  SeriesManifestV2Schema,
  SubmissionManifestSchema,
  computeConfigurationId,
  computeEvaluationInputFingerprint,
  computeSubmissionInputFingerprint,
  createUlid,
  sha256Buffer,
  sha256Canonical,
  sha256File,
  writeEvidenceManifest,
  writeJson,
  type JsonObject,
  type LoadedTask,
  type RunEnvironmentV3,
  type RunManifestV3,
  type SeriesManifestV2,
  type SubmissionManifest,
  resolveTaskPath,
} from "@carrick/gamebench-core";
import { evaluateSubmissionArchive } from "./evaluate.js";
import {
  evaluatorEnvironment,
  runCommand,
  type CommandResult,
} from "./process.js";
import { sealSubmissionWorkspace } from "./archive.js";

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

export interface CompletedEvaluation {
  evaluationDir: string;
  manifest: RunManifestV3;
}

export interface CompletedSubmission {
  submissionDir: string;
  workspace: string;
  manifest: SubmissionManifest;
  evaluations: CompletedEvaluation[];
}

interface SeriesContext {
  seriesDir: string;
  manifest: SeriesManifestV2;
  release: ReturnType<typeof ReleaseLockV3Schema.parse>;
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
  await copyFile(resolveTaskPath(task.root, schemaRelative), schemaDestination);
  const publicTaskDir = path.join(workspace, "gamebench");
  await mkdir(publicTaskDir, { recursive: true });
  await Promise.all([
    copyFile(
      resolveTaskPath(task.root, task.manifest.test_suite),
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

function hashRef(value: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`invalid sha256 hash reference: ${value}`);
  }
  return value as `sha256:${string}`;
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
  const release = ReleaseLockV3Schema.parse(
    JSON.parse(await readFile(releasePath, "utf8")),
  );
  const releaseHash = `sha256:${await sha256File(releasePath)}` as const;
  const gitCommit = gitOutput(options.repositoryRoot, ["rev-parse", "HEAD"]);
  const workingTree = await workingTreeState(options.repositoryRoot);
  const imageDigest = evaluatorImageDigest();
  const environment: RunEnvironmentV3 = {
    platform: os.platform(),
    architecture: os.arch(),
    node: process.version,
    runner_protocol: "3",
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
  const configurationId = computeConfigurationId({
    benchmark_version: version,
    benchmark_release_hash: releaseHash,
    agent,
    prompt_language: options.language,
    execution_profile: executionProfile,
    environment,
  });
  const seriesId = options.seriesId ?? createUlid();
  const seriesDir = path.resolve(options.outputRoot, version, seriesId);
  const seriesPath = path.join(seriesDir, "series.json");

  if (await pathExists(seriesPath)) {
    const existing = SeriesManifestV2Schema.parse(
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
    return { seriesDir, manifest: existing, release };
  }

  const manifest = SeriesManifestV2Schema.parse({
    schema_version: 2,
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
    submissions: [],
    evaluations: [],
  });
  await writeJson(seriesPath, manifest);
  return { seriesDir, manifest, release };
}

async function evaluateAtSeed(
  options: RunOptions,
  series: SeriesContext,
  submission: SubmissionManifest,
  archivePath: string,
  seed: number,
): Promise<CompletedEvaluation> {
  const runId = createUlid();
  const evaluationDir = path.join(series.seriesDir, "evaluations", runId);
  await mkdir(evaluationDir, { recursive: true });
  const environment = series.manifest.configuration.environment;
  if (environment.runner_protocol !== "3") {
    throw new Error("series v2 requires runner protocol 3 environment");
  }
  const inputFingerprint = computeEvaluationInputFingerprint({
    benchmark_release_hash: hashRef(series.manifest.benchmark_release_hash),
    configuration_id: hashRef(series.manifest.configuration_id),
    submission_id: submission.submission_id,
    source_snapshot_hash: hashRef(submission.source_snapshot_hash),
    task_id: submission.task_id,
    task_version: submission.task_version,
    task_hash: hashRef(submission.task_hash),
    evaluation_seed: seed,
    ...(environment.evaluator_image_digest
      ? { evaluator_image_digest: hashRef(environment.evaluator_image_digest) }
      : {}),
  });
  const startedAt = new Date();
  const baseManifest: RunManifestV3 = {
    schema_version: 3,
    benchmark_version: series.manifest.benchmark_version,
    benchmark_release_hash: series.manifest.benchmark_release_hash,
    series_id: series.manifest.series_id,
    run_id: runId,
    submission_id: submission.submission_id,
    configuration_id: series.manifest.configuration_id,
    input_fingerprint: inputFingerprint,
    task_id: submission.task_id,
    task_version: submission.task_version,
    task_hash: submission.task_hash,
    evaluation_seed: seed,
    environment,
    started_at: startedAt.toISOString(),
  };
  await writeJson(path.join(evaluationDir, "run.json"), baseManifest);

  let exitReason: RunManifestV3["exit_reason"] = "completed";
  try {
    const evaluation = await evaluateSubmissionArchive(options.task, {
      archivePath,
      sourceSnapshotHash: hashRef(submission.source_snapshot_hash),
      evaluationDir,
      seed,
    });
    await writeJson(path.join(evaluationDir, "tests.json"), evaluation.outcomes);
    await writeJson(path.join(evaluationDir, "score.json"), evaluation.score);
    await writeJson(
      path.join(evaluationDir, "evaluation-result.json"),
      EvaluationResultSchema.parse({
        schema_version: 1,
        run_id: runId,
        submission_id: submission.submission_id,
        evaluation_seed: seed,
        score: evaluation.score,
      }),
    );
  } catch (error) {
    exitReason = "evaluation-error";
    await writeJson(path.join(evaluationDir, "evaluation-error.json"), {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const finishedAt = new Date();
  const finalManifest: RunManifestV3 = {
    ...baseManifest,
    finished_at: finishedAt.toISOString(),
    exit_reason: exitReason,
    wall_time_ms: finishedAt.getTime() - startedAt.getTime(),
  };
  await writeJson(path.join(evaluationDir, "run.json"), finalManifest);
  await writeEvidenceManifest(evaluationDir);
  return { evaluationDir, manifest: finalManifest };
}

async function appendSubmission(
  series: SeriesContext,
  submission: SubmissionManifest,
): Promise<boolean> {
  const duplicate = series.manifest.submissions.some(
    (existing) => existing.included && existing.task_id === submission.task_id,
  );
  const eligible = new Set(["completed", "timeout"]).has(
    submission.development_exit_reason,
  );
  const included = eligible && !duplicate;
  series.manifest.submissions.push({
    submission_id: submission.submission_id,
    task_id: submission.task_id,
    task_hash: submission.task_hash,
    agent_invocation_index: submission.agent_invocation_index,
    included,
    ...(!eligible
      ? { exclusion_reason: `development ended as ${submission.development_exit_reason}` }
      : duplicate
        ? { exclusion_reason: "duplicate task submission; earlier eligible submission retained" }
        : {}),
  });
  series.manifest = SeriesManifestV2Schema.parse(series.manifest);
  await writeJson(path.join(series.seriesDir, "series.json"), series.manifest);
  return included;
}

async function appendEvaluation(
  series: SeriesContext,
  submission: SubmissionManifest,
  evaluation: CompletedEvaluation,
  submissionIncluded: boolean,
): Promise<void> {
  const run = evaluation.manifest;
  const hasScore = await pathExists(path.join(evaluation.evaluationDir, "score.json"));
  const duplicate = series.manifest.evaluations.some(
    (existing) =>
      existing.included &&
      existing.submission_id === submission.submission_id &&
      existing.evaluation_seed === run.evaluation_seed,
  );
  const included = submissionIncluded && hasScore && !duplicate;
  series.manifest.evaluations.push({
    run_id: run.run_id,
    submission_id: submission.submission_id,
    task_id: submission.task_id,
    task_hash: submission.task_hash,
    evaluation_seed: run.evaluation_seed,
    included,
    ...(!submissionIncluded
      ? { exclusion_reason: "parent submission is excluded" }
      : !hasScore
        ? { exclusion_reason: "evaluation did not produce a score" }
        : duplicate
          ? { exclusion_reason: "duplicate submission and seed; earlier evaluation retained" }
          : {}),
  });
  series.manifest = SeriesManifestV2Schema.parse(series.manifest);
  await writeJson(path.join(series.seriesDir, "series.json"), series.manifest);
}

async function developSubmission(
  options: RunOptions,
  series: SeriesContext,
  invocationIndex: number,
): Promise<CompletedSubmission> {
  const submissionId = createUlid();
  const submissionDir = path.join(series.seriesDir, "submissions", submissionId);
  const workspace = path.join(submissionDir, "workspace");
  await mkdir(submissionDir, { recursive: true });
  const stateSchemaPath = await prepareSubmissionWorkspace(
    options.repositoryRoot,
    options.task,
    workspace,
  );

  const promptSource = resolveTaskPath(
    options.task.root,
    options.task.manifest.prompt[options.language],
  );
  const promptPath = path.join(submissionDir, "prompt.md");
  await copyFile(promptSource, promptPath);
  let referenceDir: string | undefined;
  if (options.task.manifest.reference) {
    referenceDir = path.join(submissionDir, "reference-material");
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

  const installArgs = ["install", "--frozen-lockfile", "--ignore-workspace"];
  if (options.task.manifest.network_policy !== "full") {
    installArgs.push("--offline");
  }
  const preparation = await runCommand("pnpm", installArgs, {
    cwd: workspace,
    env: evaluatorEnvironment(),
    stdoutPath: path.join(submissionDir, "prepare.log"),
    stderrPath: path.join(submissionDir, "prepare.stderr.log"),
    timeoutMs: 120_000,
  });

  const startedAt = new Date();
  const agentCommandHash = sha256Buffer(Buffer.from(options.agentCommand, "utf8"));
  const developmentParameters = {
    agent_command_hash: agentCommandHash,
  } satisfies JsonObject;
  const developmentInputFingerprint = computeSubmissionInputFingerprint({
    configuration_id: hashRef(series.manifest.configuration_id),
    agent_command_hash: agentCommandHash,
    task_id: options.task.manifest.id,
    task_version: options.task.manifest.version,
    task_hash: hashRef(options.task.hash),
    prompt_language: options.language,
    budget_seconds: options.task.manifest.budget_seconds,
    network_policy: options.task.manifest.network_policy,
    development_parameters: developmentParameters,
  });

  const trajectoryStart = {
    type: "shell-command",
    at: startedAt.toISOString(),
    command_hash: agentCommandHash,
  };
  await writeFile(
    path.join(submissionDir, "trajectory.jsonl"),
    `${JSON.stringify(trajectoryStart)}\n`,
    "utf8",
  );

  let agentResult: CommandResult;
  if (preparation.exitCode !== 0) {
    const message = `workspace dependency preparation failed with exit ${preparation.exitCode}\n`;
    await Promise.all([
      writeFile(path.join(submissionDir, "stdout.log"), "", "utf8"),
      writeFile(path.join(submissionDir, "stderr.log"), message, "utf8"),
    ]);
    agentResult = {
      exitCode: preparation.exitCode,
      signal: preparation.signal,
      timedOut: preparation.timedOut,
      durationMs: 0,
    };
  } else {
    const deadline = new Date(
      startedAt.getTime() + options.task.manifest.budget_seconds * 1_000,
    ).toISOString();
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
        CAGB_EVALUATION_SEEDS: JSON.stringify(series.release.official.evaluation_seeds),
        CAGB_NETWORK_POLICY: options.task.manifest.network_policy,
        ...(referenceDir ? { CAGB_REFERENCE_DIR: referenceDir } : {}),
        CAGB_DEADLINE_AT: deadline,
      },
      stdoutPath: path.join(submissionDir, "stdout.log"),
      stderrPath: path.join(submissionDir, "stderr.log"),
      timeoutMs: options.task.manifest.budget_seconds * 1_000,
    });
  }

  if (options.trajectoryPath) {
    const trajectorySource = path.resolve(workspace, options.trajectoryPath);
    if (!trajectorySource.startsWith(`${path.resolve(workspace)}${path.sep}`)) {
      throw new Error("trajectory path escapes the submission workspace");
    }
    await copyFile(
      trajectorySource,
      path.join(submissionDir, "agent-trajectory.jsonl"),
    );
  }

  const archivePath = path.join(submissionDir, "source.tar.zst");
  const sealed = await sealSubmissionWorkspace(
    workspace,
    archivePath,
    path.join(submissionDir, "archive.log"),
  );
  await writeFile(
    path.join(submissionDir, "source.sha256"),
    `${sealed.sourceSnapshotHash.slice("sha256:".length)}  source.tar.zst\n`,
    "utf8",
  );

  const developmentExitReason = preparation.exitCode !== 0
    ? "preparation-error" as const
    : agentResult.timedOut
      ? "timeout" as const
      : agentResult.exitCode !== 0
        ? "agent-error" as const
        : "completed" as const;
  const finishedAt = new Date();
  const manifest = SubmissionManifestSchema.parse({
    schema_version: 1,
    benchmark_version: series.manifest.benchmark_version,
    benchmark_release_hash: series.manifest.benchmark_release_hash,
    series_id: series.manifest.series_id,
    submission_id: submissionId,
    configuration_id: series.manifest.configuration_id,
    development_input_fingerprint: developmentInputFingerprint,
    agent_command_hash: agentCommandHash,
    development_parameters: developmentParameters,
    task_id: options.task.manifest.id,
    task_version: options.task.manifest.version,
    task_hash: options.task.hash,
    agent_invocation_index: invocationIndex,
    execution_profile: series.manifest.configuration.execution_profile,
    prompt_language: options.language,
    network_policy: options.task.manifest.network_policy,
    agent: series.manifest.configuration.agent,
    environment: series.manifest.configuration.environment,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    development_exit_reason: developmentExitReason,
    source_snapshot_hash: sealed.sourceSnapshotHash,
    usage: { source: "not-reported" },
  });
  await writeJson(path.join(submissionDir, "submission.json"), manifest);
  await writeJson(path.join(submissionDir, "telemetry.json"), {
    schema_version: 2,
    wall_time_ms: finishedAt.getTime() - startedAt.getTime(),
    agent_time_ms: agentResult.durationMs,
    tokens: null,
    cost_usd: null,
    cost_source: "not-reported",
  });
  await writeFile(
    path.join(submissionDir, "trajectory.jsonl"),
    `${JSON.stringify(trajectoryStart)}\n${JSON.stringify({
      type: "shell-result",
      at: finishedAt.toISOString(),
      exit_code: agentResult.exitCode,
      signal: agentResult.signal,
      timed_out: agentResult.timedOut,
    })}\n`,
    "utf8",
  );
  await writeEvidenceManifest(submissionDir);

  const submissionIncluded = await appendSubmission(series, manifest);
  const evaluations: CompletedEvaluation[] = [];
  for (const seed of series.release.official.evaluation_seeds) {
    const evaluation = await evaluateAtSeed(
      options,
      series,
      manifest,
      archivePath,
      seed,
    );
    evaluations.push(evaluation);
    await appendEvaluation(series, manifest, evaluation, submissionIncluded);
  }
  return { submissionDir, workspace, manifest, evaluations };
}

export function developmentInvocationCount(
  official: boolean,
  repeat: number,
  existingInvocations = 0,
): number {
  if (official && existingInvocations > 0) {
    throw new Error("Official task development may not be retried in the same series");
  }
  return official ? 1 : repeat;
}

export async function runTask(options: RunOptions): Promise<CompletedSubmission[]> {
  const series = await createSeriesContext(options);
  const existingInvocations = series.manifest.submissions.filter(
    (submission) => submission.task_id === options.task.manifest.id,
  ).length;
  const count = developmentInvocationCount(
    options.official,
    options.repeat,
    existingInvocations,
  );
  const completed: CompletedSubmission[] = [];
  for (let index = 0; index < count; index += 1) {
    completed.push(
      await developSubmission(
        options,
        series,
        existingInvocations + index + 1,
      ),
    );
  }
  return completed;
}
