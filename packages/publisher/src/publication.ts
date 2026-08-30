import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  AggregateResultSchema,
  AnyPublicationManifestSchema,
  AnyReleaseLockSchema,
  AnyResultIndexSchema,
  AnySeriesManifestSchema,
  EvaluationResultSchema,
  PublicationManifestV1Schema,
  PublicationManifestV2Schema,
  ReproductionRecordSchema,
  ReproductionRecordV2Schema,
  RunManifestV2Schema,
  RunManifestV3Schema,
  ScoreResultSchema,
  SubmissionManifestSchema,
  VerificationRecordSchema,
  VerificationRecordV2Schema,
  aggregateAttempts,
  aggregateEvaluationsV3,
  assertScoreResult,
  compareSemanticVersions,
  computeConfigurationId,
  computeEvaluationInputFingerprint,
  computeSubmissionInputFingerprint,
  resolveReleasedTasks,
  scoreResultIdentity,
  sha256Canonical,
  sha256File,
  verifyEvidenceManifest,
  writeJson,
  type AnyPublicationManifest,
  type AnyReleaseLock,
  type AnyResultIndex,
  type ArtifactRef,
  type JsonValue,
  type LoadedTask,
  type PublicationManifestV1,
  type PublicationManifestV2,
  type ReleaseLockV2,
  type ReleaseLockV3,
  type ReproductionRecord,
  type RunManifestV2,
  type RunManifestV3,
  type ScoreResult,
  type SeriesManifestV1,
  type SeriesManifestV2,
  type SubmissionManifest,
  type VerificationRecord,
} from "@carrick/gamebench-core";
import type { ArtifactStore } from "./store.js";

type HashRef = `sha256:${string}`;
type SubmissionFingerprintInput = Parameters<
  typeof computeSubmissionInputFingerprint
>[0];
type PublicationPayload =
  | Omit<PublicationManifestV1, "publication_id">
  | Omit<PublicationManifestV2, "publication_id">;

interface ReleaseContext {
  lock: AnyReleaseLock;
  releaseHash: HashRef;
  tasksById: Map<string, LoadedTask>;
  releaseTasks: LoadedTask[];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function sameJson(left: unknown, right: unknown): boolean {
  return sha256Canonical(asJson(left)) === sha256Canonical(asJson(right));
}

function assertSameJson(left: unknown, right: unknown, message: string): void {
  if (!sameJson(left, right)) {
    throw new Error(message);
  }
}

async function findPngFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) {
    return [];
  }
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...await findPngFiles(absolute));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".png") {
      found.push(absolute);
    }
  }
  return found.sort();
}

async function loadReleaseContext(
  repositoryRoot: string,
  benchmarkVersion: string,
  expectedReleaseHash?: string,
): Promise<ReleaseContext> {
  const lockPath = path.join(
    repositoryRoot,
    "benchmark",
    "releases",
    `${benchmarkVersion}.json`,
  );
  const lock = AnyReleaseLockSchema.parse(await readJson(lockPath));
  if (lock.benchmark_version !== benchmarkVersion) {
    throw new Error("release lock benchmark version does not match its file name");
  }
  const releaseHash = `sha256:${await sha256File(lockPath)}` as const;
  if (expectedReleaseHash !== undefined && releaseHash !== expectedReleaseHash) {
    throw new Error("publication release hash mismatch");
  }
  const resolvedTasks = await resolveReleasedTasks(lock, repositoryRoot);
  const releaseTasks = resolvedTasks.map((task) => {
    if (!task.source) {
      throw new Error(`release task source is unavailable: ${task.id}`);
    }
    return task.source;
  });
  const tasksById = new Map(
    releaseTasks.map((task) => [task.manifest.id, task]),
  );
  return { lock, releaseHash, tasksById, releaseTasks };
}

export function computePublicationId(
  publication: PublicationPayload,
): HashRef {
  return sha256Canonical(asJson(publication));
}

export function verifyPublicationIdentity(input: unknown): AnyPublicationManifest {
  const publication = AnyPublicationManifestSchema.parse(input);
  const { publication_id: claimed, ...payload } = publication;
  const actual = computePublicationId(payload as PublicationPayload);
  if (actual !== claimed) {
    throw new Error(
      `publication ID mismatch: expected ${actual}, received ${claimed}`,
    );
  }
  return publication;
}

function configurationIdFor(
  benchmarkVersion: string,
  benchmarkReleaseHash: string,
  configuration: SeriesManifestV1["configuration"] | SeriesManifestV2["configuration"],
): HashRef {
  return computeConfigurationId({
    benchmark_version: benchmarkVersion,
    benchmark_release_hash: benchmarkReleaseHash as HashRef,
    agent: configuration.agent,
    prompt_language: configuration.prompt_language,
    execution_profile: configuration.execution_profile,
    environment: configuration.environment,
  });
}

function legacyInputFingerprint(
  configurationId: string,
  task: LoadedTask,
  seed: number,
  promptLanguage: "en" | "zh",
): HashRef {
  return sha256Canonical({
    configuration_id: configurationId as HashRef,
    task_id: task.manifest.id,
    task_version: task.manifest.version,
    task_hash: task.hash,
    seed,
    prompt_language: promptLanguage,
    budget_seconds: task.manifest.budget_seconds,
    network_policy: task.manifest.network_policy,
  });
}

function legacyAggregate(
  inputs: Array<{ task: LoadedTask["manifest"]; score: ScoreResult }>,
  expectedTasks: LoadedTask[],
  schemaVersion: 1 | 2,
): PublicationManifestV1["aggregate"] {
  const computed = aggregateAttempts(
    inputs,
    expectedTasks.map((task) => task.manifest),
  );
  return AggregateResultSchema.parse({
    ...computed,
    schema_version: schemaVersion,
  }) as PublicationManifestV1["aggregate"];
}

function assertLegacySeriesIdentity(series: SeriesManifestV1): void {
  const expected = configurationIdFor(
    series.benchmark_version,
    series.benchmark_release_hash,
    series.configuration,
  );
  if (expected !== series.configuration_id) {
    throw new Error("series configuration ID does not match its configuration");
  }
  if (series.git_commit !== series.configuration.environment.git_commit) {
    throw new Error("series Git commit does not match its environment");
  }
}

function assertLegacyRunBinding(
  reference: SeriesManifestV1["runs"][number],
  run: RunManifestV2,
  series: SeriesManifestV1,
  task: LoadedTask,
): void {
  if (
    reference.run_id !== run.run_id ||
    reference.task_id !== run.task_id ||
    reference.task_hash !== run.task_hash ||
    reference.seed !== run.seed ||
    reference.attempt !== run.attempt ||
    run.series_id !== series.series_id ||
    run.benchmark_version !== series.benchmark_version ||
    run.benchmark_release_hash !== series.benchmark_release_hash ||
    run.configuration_id !== series.configuration_id ||
    run.task_version !== task.manifest.version ||
    run.task_hash !== task.hash ||
    run.execution_profile !== series.configuration.execution_profile ||
    run.prompt_language !== series.configuration.prompt_language ||
    run.network_policy !== task.manifest.network_policy ||
    !sameJson(run.agent, series.configuration.agent) ||
    !sameJson(run.environment, series.configuration.environment)
  ) {
    throw new Error(`series reference does not match run ${reference.run_id}`);
  }
  const expectedFingerprint = legacyInputFingerprint(
    series.configuration_id,
    task,
    run.seed,
    series.configuration.prompt_language,
  );
  if (run.input_fingerprint !== expectedFingerprint) {
    throw new Error(`run input fingerprint mismatch: ${run.run_id}`);
  }
}

function officialCells(lock: ReleaseLockV2): Set<string> {
  return new Set(
    lock.tasks.flatMap((task) =>
      lock.official.seeds.map((seed) => `${task.id}\0${seed}`),
    ),
  );
}

export function assertOfficialEligibility(
  publication: PublicationManifestV1,
  lock: ReleaseLockV2,
  sourceTreeDirty: boolean,
): void {
  if (publication.aggregate.schema_version !== lock.scoring.aggregate) {
    throw new Error(
      `official publication aggregate schema ${publication.aggregate.schema_version} ` +
        `does not match release ${lock.scoring.aggregate}`,
    );
  }
  if (publication.configuration.execution_profile !== "official-candidate") {
    throw new Error("official publication requires official-candidate execution");
  }
  if (sourceTreeDirty) {
    throw new Error("official publication requires a clean source tree");
  }
  if (
    publication.benchmark.git_commit === "unknown" ||
    publication.configuration.environment.git_commit === "unknown"
  ) {
    throw new Error("official publication requires a known Git commit");
  }
  const expected = officialCells(lock);
  const included = new Map<string, number>();
  const evaluatorImages = new Set<string>();
  for (const run of publication.runs) {
    if (!run.included) continue;
    const key = `${run.task_id}\0${run.seed}`;
    included.set(key, (included.get(key) ?? 0) + 1);
    if (!run.score) throw new Error(`official run ${run.run_id} has no score`);
    if (run.exit_reason !== "completed" && run.exit_reason !== "timeout") {
      throw new Error(`official run ${run.run_id} has invalid exit reason ${run.exit_reason}`);
    }
    if (!run.reproduction) {
      throw new Error(`official run ${run.run_id} was not rebuilt from clean source`);
    }
    if (!run.verification) {
      throw new Error(`official run ${run.run_id} is not operator verified`);
    }
    if (run.verification.network_attestation === "unverified") {
      throw new Error(`official run ${run.run_id} lacks network attestation`);
    }
    if (
      run.network_policy === "model-api-only" &&
      run.verification.network_attestation !== "operator-attested-model-api-only"
    ) {
      throw new Error(`official run ${run.run_id} requires model-api-only network attestation`);
    }
    evaluatorImages.add(run.verification.evaluator_image_digest);
  }
  for (const cell of expected) {
    if (included.get(cell) !== 1) {
      const [taskId, seed] = cell.split("\0");
      throw new Error(
        `official publication requires exactly one included run for ${taskId} seed ${seed}`,
      );
    }
  }
  for (const cell of included.keys()) {
    if (!expected.has(cell)) {
      throw new Error(`official publication contains an unexpected cell: ${cell}`);
    }
  }
  if (evaluatorImages.size !== 1) {
    throw new Error("official publication must use one evaluator image digest");
  }
  for (const run of publication.runs) {
    if (run.included && !run.artifacts.some((artifact) => artifact.role === "playable")) {
      throw new Error(`official run ${run.run_id} has no playable artifact`);
    }
    if (
      run.included &&
      !run.artifacts.some(
        (artifact) => artifact.role === "screenshot" &&
          artifact.file_name.endsWith("-showcase.png"),
      )
    ) {
      throw new Error(`official run ${run.run_id} has no deterministic showcase`);
    }
  }
}

async function legacyPublicArtifacts(
  runDir: string,
  run: RunManifestV2,
  taskRoot: string,
  store: ArtifactStore,
): Promise<ArtifactRef[]> {
  const outputRoot = path.join(runDir, "public");
  const sourceArchive = path.join(outputRoot, "clean-source.tar.zst");
  const playable = path.join(outputRoot, "playable");
  if (!(await exists(sourceArchive))) {
    throw new Error(`run ${run.run_id} has not been prepared for publication`);
  }
  const evidence = await verifyEvidenceManifest(runDir);
  if (!evidence.valid) throw new Error(evidence.errors.join("\n"));
  const artifacts: ArtifactRef[] = [
    await store.put(sourceArchive, {
      role: "clean-source",
      fileName: "clean-source.tar.zst",
      mediaType: "application/zstd",
    }),
  ];
  if (await exists(path.join(playable, "index.html"))) {
    artifacts.push(await store.put(playable, {
      role: "playable",
      fileName: "index.html",
      mediaType: "text/html",
      kind: "directory",
    }));
  }
  const showcase = path.join(outputRoot, "showcase.png");
  if (await exists(showcase)) {
    artifacts.push(await store.put(showcase, {
      role: "screenshot",
      fileName: `${safeTaskName(run.task_id)}-showcase.png`,
      mediaType: "image/png",
    }));
  }
  const screenshots = await findPngFiles(path.join(runDir, "playwright"));
  for (const [index, screenshot] of screenshots.entries()) {
    artifacts.push(await store.put(screenshot, {
      role: "screenshot",
      fileName: `${safeTaskName(run.task_id)}-${index + 1}.png`,
      mediaType: "image/png",
    }));
  }
  const thirdParty = path.join(taskRoot, "THIRD_PARTY.yml");
  if (await exists(thirdParty)) {
    artifacts.push(await store.put(thirdParty, {
      role: "license",
      fileName: "THIRD_PARTY.yml",
      mediaType: "text/yaml",
    }));
  }
  return artifacts;
}

function safeTaskName(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function optionalParsed<T>(
  filePath: string,
  parse: (input: unknown) => T,
): Promise<T | undefined> {
  return await exists(filePath) ? parse(await readJson(filePath)) : undefined;
}

async function loadLegacyScore(runDir: string): Promise<ScoreResult | undefined> {
  return optionalParsed(path.join(runDir, "score.json"), (input) =>
    ScoreResultSchema.parse(input));
}

async function loadLegacyReproduction(
  runDir: string,
): Promise<ReproductionRecord | undefined> {
  return optionalParsed(path.join(runDir, "reproduction.json"), (input) =>
    ReproductionRecordSchema.parse(input));
}

async function loadLegacyVerification(
  runDir: string,
): Promise<VerificationRecord | undefined> {
  return optionalParsed(path.join(runDir, "verification.json"), (input) =>
    VerificationRecordSchema.parse(input));
}

async function wallTime(runDir: string): Promise<number | undefined> {
  const telemetryPath = path.join(runDir, "telemetry.json");
  if (!(await exists(telemetryPath))) return undefined;
  const telemetry = await readJson(telemetryPath) as { wall_time_ms?: unknown };
  return typeof telemetry.wall_time_ms === "number"
    ? telemetry.wall_time_ms
    : undefined;
}

async function publishLegacySeries(
  options: PublishSeriesOptions,
  series: SeriesManifestV1,
  context: ReleaseContext,
): Promise<PublicationManifestV1> {
  if (context.lock.schema_version !== 2) {
    throw new Error("legacy publication requires a v2 benchmark release lock");
  }
  assertLegacySeriesIdentity(series);
  const publishedRuns: PublicationManifestV1["runs"] = [];
  const aggregateInputs: Array<{ task: LoadedTask["manifest"]; score: ScoreResult }> = [];

  for (const reference of series.runs) {
    const runDir = path.join(options.seriesDir, reference.run_id);
    const run = RunManifestV2Schema.parse(await readJson(path.join(runDir, "run.json")));
    const task = context.tasksById.get(reference.task_id);
    if (!task) throw new Error(`unknown task in series: ${reference.task_id}`);
    assertLegacyRunBinding(reference, run, series, task);
    if (!run.exit_reason) throw new Error(`run ${run.run_id} is not finished`);
    const score = await loadLegacyScore(runDir);
    if (score) assertScoreResult(task.manifest, task.hash, score);
    if (reference.included && !score) {
      throw new Error(`included run ${run.run_id} has no score`);
    }
    if (reference.included && score) {
      aggregateInputs.push({ task: task.manifest, score });
    }
    const reproduction = await loadLegacyReproduction(runDir);
    if (score && !reproduction) {
      throw new Error(`scored run ${run.run_id} was not rebuilt from clean source`);
    }
    const artifacts = score
      ? await legacyPublicArtifacts(runDir, run, task.root, options.store)
      : [];
    const verification = await loadLegacyVerification(runDir);
    if (score && reproduction) {
      const source = artifacts.find((artifact) => artifact.role === "clean-source");
      const scoreHash = sha256Canonical(scoreResultIdentity(score));
      if (
        !source ||
        source.artifact_id !== reproduction.clean_source_artifact_id ||
        reproduction.benchmark_release_hash !== run.benchmark_release_hash ||
        reproduction.recomputed_score_hash !== scoreHash
      ) {
        throw new Error(`reproduction record does not match run ${run.run_id}`);
      }
      if (verification) {
        const evidenceHash = `sha256:${await sha256File(path.join(runDir, "MANIFEST.sha256"))}`;
        if (
          verification.benchmark_release_hash !== run.benchmark_release_hash ||
          verification.git_commit !== run.environment.git_commit ||
          verification.clean_source_artifact_id !== reproduction.clean_source_artifact_id ||
          verification.recomputed_score_hash !== reproduction.recomputed_score_hash ||
          verification.evidence_manifest_hash !== evidenceHash
        ) {
          throw new Error(`verification record does not match run ${run.run_id}`);
        }
      }
    }
    const elapsed = await wallTime(runDir);
    publishedRuns.push({
      run_id: run.run_id,
      input_fingerprint: run.input_fingerprint,
      task_id: run.task_id,
      task_version: run.task_version,
      task_hash: run.task_hash,
      seed: run.seed,
      attempt: run.attempt,
      included: reference.included,
      network_policy: run.network_policy,
      exit_reason: run.exit_reason,
      ...(score ? { score } : {}),
      ...(elapsed === undefined ? {} : { wall_time_ms: elapsed }),
      ...(run.usage ? { usage: run.usage } : {}),
      artifacts,
      ...(reproduction ? { reproduction } : {}),
      ...(verification ? { verification } : {}),
    });
  }
  if (aggregateInputs.length === 0) {
    throw new Error("publication requires at least one included scored run");
  }
  const aggregate = legacyAggregate(
    aggregateInputs,
    context.releaseTasks,
    context.lock.scoring.aggregate,
  );
  const payload: Omit<PublicationManifestV1, "publication_id"> = {
    schema_version: 1,
    created_at: series.created_at,
    tier: options.tier,
    series_id: series.series_id,
    benchmark: {
      version: series.benchmark_version,
      release_hash: series.benchmark_release_hash,
      git_commit: series.git_commit,
    },
    configuration: {
      configuration_id: series.configuration_id,
      ...series.configuration,
    },
    aggregate,
    runs: publishedRuns,
    review_summaries: [],
  };
  const publication = PublicationManifestV1Schema.parse({
    ...payload,
    publication_id: computePublicationId(payload),
  });
  if (options.tier === "official") {
    assertOfficialEligibility(
      publication,
      context.lock,
      series.configuration.environment.source_tree_dirty,
    );
  }
  return publication;
}

async function readAgentCommandHash(submissionDir: string): Promise<HashRef> {
  const firstLine = (await readFile(path.join(submissionDir, "trajectory.jsonl"), "utf8"))
    .split("\n")
    .find(Boolean);
  if (!firstLine) throw new Error("submission trajectory has no invocation record");
  const record = JSON.parse(firstLine) as { command_hash?: unknown };
  if (
    typeof record.command_hash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(record.command_hash)
  ) {
    throw new Error("submission trajectory has no valid command hash");
  }
  return record.command_hash as HashRef;
}

function assertV2SeriesIdentity(series: SeriesManifestV2): void {
  const expected = configurationIdFor(
    series.benchmark_version,
    series.benchmark_release_hash,
    series.configuration,
  );
  if (expected !== series.configuration_id) {
    throw new Error("series configuration ID does not match its configuration");
  }
  if (series.git_commit !== series.configuration.environment.git_commit) {
    throw new Error("series Git commit does not match its environment");
  }
}

function assertSubmissionBinding(
  reference: SeriesManifestV2["submissions"][number],
  submission: SubmissionManifest,
  series: SeriesManifestV2,
  task: LoadedTask,
): void {
  if (
    reference.submission_id !== submission.submission_id ||
    reference.task_id !== submission.task_id ||
    reference.task_hash !== submission.task_hash ||
    reference.agent_invocation_index !== submission.agent_invocation_index ||
    submission.series_id !== series.series_id ||
    submission.benchmark_version !== series.benchmark_version ||
    submission.benchmark_release_hash !== series.benchmark_release_hash ||
    submission.configuration_id !== series.configuration_id ||
    submission.task_version !== task.manifest.version ||
    submission.task_hash !== task.hash ||
    submission.execution_profile !== series.configuration.execution_profile ||
    submission.prompt_language !== series.configuration.prompt_language ||
    submission.network_policy !== task.manifest.network_policy ||
    !sameJson(submission.agent, series.configuration.agent) ||
    !sameJson(submission.environment, series.configuration.environment)
  ) {
    throw new Error(`series reference does not match submission ${reference.submission_id}`);
  }
}

function assertEvaluationBinding(
  reference: SeriesManifestV2["evaluations"][number],
  run: RunManifestV3,
  series: SeriesManifestV2,
  submission: SubmissionManifest,
): void {
  if (
    reference.run_id !== run.run_id ||
    reference.submission_id !== run.submission_id ||
    reference.task_id !== run.task_id ||
    reference.task_hash !== run.task_hash ||
    reference.evaluation_seed !== run.evaluation_seed ||
    run.series_id !== series.series_id ||
    run.benchmark_version !== series.benchmark_version ||
    run.benchmark_release_hash !== series.benchmark_release_hash ||
    run.configuration_id !== series.configuration_id ||
    run.submission_id !== submission.submission_id ||
    run.task_id !== submission.task_id ||
    run.task_version !== submission.task_version ||
    run.task_hash !== submission.task_hash ||
    !sameJson(run.environment, series.configuration.environment)
  ) {
    throw new Error(`series reference does not match evaluation ${reference.run_id}`);
  }
  const expectedFingerprint = computeEvaluationInputFingerprint({
    benchmark_release_hash: series.benchmark_release_hash as HashRef,
    configuration_id: series.configuration_id as HashRef,
    submission_id: submission.submission_id,
    source_snapshot_hash: submission.source_snapshot_hash as HashRef,
    task_id: submission.task_id,
    task_version: submission.task_version,
    task_hash: submission.task_hash as HashRef,
    evaluation_seed: run.evaluation_seed,
    ...(run.environment.evaluator_image_digest
      ? { evaluator_image_digest: run.environment.evaluator_image_digest as HashRef }
      : {}),
  });
  if (run.input_fingerprint !== expectedFingerprint) {
    throw new Error(`evaluation input fingerprint mismatch: ${run.run_id}`);
  }
}

function evaluationSetHash(
  evaluations: Array<{ evaluation_seed: number; score: ScoreResult }>,
): HashRef {
  return sha256Canonical(
    evaluations
      .map((evaluation) => ({
        evaluation_seed: evaluation.evaluation_seed,
        score_hash: sha256Canonical(scoreResultIdentity(evaluation.score)),
      }))
      .sort((left, right) => left.evaluation_seed - right.evaluation_seed),
  );
}

async function submissionArtifacts(
  submissionDir: string,
  task: LoadedTask,
  required: boolean,
  store: ArtifactStore,
): Promise<ArtifactRef[]> {
  const publicRoot = path.join(submissionDir, "public");
  const source = path.join(publicRoot, "clean-source.tar.zst");
  if (!(await exists(source))) {
    if (required) throw new Error("included submission has no clean source archive");
    return [];
  }
  const artifacts: ArtifactRef[] = [await store.put(source, {
    role: "clean-source",
    fileName: "clean-source.tar.zst",
    mediaType: "application/zstd",
  })];
  const playable = path.join(publicRoot, "playable");
  if (await exists(path.join(playable, "index.html"))) {
    artifacts.push(await store.put(playable, {
      role: "playable",
      fileName: "index.html",
      mediaType: "text/html",
      kind: "directory",
    }));
  }
  const license = path.join(task.root, "THIRD_PARTY.yml");
  if (await exists(license)) {
    artifacts.push(await store.put(license, {
      role: "license",
      fileName: "THIRD_PARTY.yml",
      mediaType: "text/yaml",
    }));
  }
  return artifacts;
}

async function evaluationArtifacts(
  evaluationDir: string,
  run: RunManifestV3,
  store: ArtifactStore,
): Promise<ArtifactRef[]> {
  const evidence = await verifyEvidenceManifest(evaluationDir);
  if (!evidence.valid) throw new Error(evidence.errors.join("\n"));
  const artifacts: ArtifactRef[] = [await store.put(
    path.join(evaluationDir, "MANIFEST.sha256"),
    {
      role: "evidence",
      fileName: `${run.run_id}-evidence.sha256`,
      mediaType: "text/plain",
    },
  )];
  const showcase = path.join(evaluationDir, "public", "showcase.png");
  if (await exists(showcase)) {
    artifacts.push(await store.put(showcase, {
      role: "screenshot",
      fileName: `${safeTaskName(run.task_id)}-${run.evaluation_seed}-showcase.png`,
      mediaType: "image/png",
    }));
  }
  return artifacts;
}

interface LoadedV2Evaluation {
  reference: SeriesManifestV2["evaluations"][number];
  run: RunManifestV3;
  score?: ScoreResult;
  artifacts: ArtifactRef[];
}

export function assertOfficialEligibilityV2(
  publication: PublicationManifestV2,
  lock: ReleaseLockV3,
): void {
  if (publication.configuration.execution_profile !== "official-candidate") {
    throw new Error("official publication requires official-candidate execution");
  }
  if (publication.configuration.environment.source_tree_dirty) {
    throw new Error("official publication requires a clean source tree");
  }
  if (
    publication.benchmark.git_commit === "unknown" ||
    publication.configuration.environment.git_commit === "unknown"
  ) {
    throw new Error("official publication requires a known Git commit");
  }
  const configuredImage = publication.configuration.environment.evaluator_image_digest;
  if (!configuredImage) {
    throw new Error("official publication requires a digest-pinned evaluator image");
  }
  const includedByTask = new Map<string, PublicationManifestV2["submissions"]>();
  const images = new Set<string>();
  for (const submission of publication.submissions) {
    if (!submission.included) continue;
    const group = includedByTask.get(submission.task_id) ?? [];
    group.push(submission);
    includedByTask.set(submission.task_id, group);
    if (
      submission.development_exit_reason !== "completed" &&
      submission.development_exit_reason !== "timeout"
    ) {
      throw new Error(`official submission ${submission.submission_id} has invalid development exit reason`);
    }
    if (!submission.reproduction || !submission.verification) {
      throw new Error(`official submission ${submission.submission_id} is not reproduced and verified`);
    }
    if (submission.verification.network_attestation === "unverified") {
      throw new Error(`official submission ${submission.submission_id} lacks network attestation`);
    }
    if (
      submission.network_policy === "model-api-only" &&
      submission.verification.network_attestation !== "operator-attested-model-api-only"
    ) {
      throw new Error(`official submission ${submission.submission_id} requires model-api-only attestation`);
    }
    if (submission.verification.evaluator_image_digest !== configuredImage) {
      throw new Error(`official submission ${submission.submission_id} uses a different evaluator image`);
    }
    images.add(submission.verification.evaluator_image_digest);
    if (!submission.artifacts.some((artifact) => artifact.role === "clean-source")) {
      throw new Error(`official submission ${submission.submission_id} has no clean source`);
    }
    if (!submission.artifacts.some((artifact) => artifact.role === "playable")) {
      throw new Error(`official submission ${submission.submission_id} has no playable artifact`);
    }
    const releaseTask = lock.tasks.find((task) => task.id === submission.task_id);
    if (releaseTask?.track === "reproduce" &&
      !submission.artifacts.some((artifact) => artifact.role === "license")) {
      throw new Error(`official reproduce submission ${submission.submission_id} has no license`);
    }
    const includedEvaluations = submission.evaluations.filter((evaluation) => evaluation.included);
    for (const seed of lock.official.evaluation_seeds) {
      if (includedEvaluations.filter((evaluation) => evaluation.evaluation_seed === seed).length !== 1) {
        throw new Error(`official submission ${submission.submission_id} requires seed ${seed}`);
      }
    }
    if (includedEvaluations.length !== lock.official.evaluation_seeds.length) {
      throw new Error(`official submission ${submission.submission_id} contains unexpected evaluations`);
    }
    for (const evaluation of includedEvaluations) {
      if (evaluation.exit_reason !== "completed" || !evaluation.score) {
        throw new Error(`official evaluation ${evaluation.run_id} is not completed and scored`);
      }
      if (!evaluation.artifacts.some((artifact) => artifact.role === "evidence")) {
        throw new Error(`official evaluation ${evaluation.run_id} has no evidence artifact`);
      }
      if (!evaluation.artifacts.some((artifact) =>
        artifact.role === "screenshot" && artifact.file_name.endsWith("-showcase.png"))) {
        throw new Error(`official evaluation ${evaluation.run_id} has no deterministic showcase`);
      }
    }
  }
  for (const task of lock.tasks.filter((task) => task.track === publication.board)) {
    if ((includedByTask.get(task.id)?.length ?? 0) !== 1) {
      throw new Error(`official publication requires exactly one included submission for ${task.id}`);
    }
    if (publication.submissions.filter((submission) => submission.task_id === task.id).length !== 1) {
      throw new Error(`official publication requires exactly one Agent invocation for ${task.id}`);
    }
  }
  for (const taskId of includedByTask.keys()) {
    if (!lock.tasks.some((task) => task.id === taskId && task.track === publication.board)) {
      throw new Error(`official publication contains unexpected task ${taskId}`);
    }
  }
  if (images.size !== 1) {
    throw new Error("official publication must use one evaluator image digest");
  }
}

async function publishV2Series(
  options: PublishSeriesOptions,
  series: SeriesManifestV2,
  context: ReleaseContext,
): Promise<PublicationManifestV2> {
  if (context.lock.schema_version !== 3) {
    throw new Error("series v2 publication requires a v3 benchmark release lock");
  }
  const firstIncluded = series.submissions.find((submission) => submission.included);
  const inferredBoard = firstIncluded
    ? context.tasksById.get(firstIncluded.task_id)?.manifest.track
    : undefined;
  const board = options.board ?? inferredBoard ?? "build";
  assertV2SeriesIdentity(series);
  const submissionsById = new Map<string, SubmissionManifest>();
  const submissionDirs = new Map<string, string>();
  for (const reference of series.submissions) {
    const submissionDir = path.join(options.seriesDir, "submissions", reference.submission_id);
    const submission = SubmissionManifestSchema.parse(
      await readJson(path.join(submissionDir, "submission.json")),
    );
    const task = context.tasksById.get(reference.task_id);
    if (!task) throw new Error(`unknown submission task: ${reference.task_id}`);
    assertSubmissionBinding(reference, submission, series, task);
    const sourceHash = `sha256:${await sha256File(path.join(submissionDir, "source.tar.zst"))}` as HashRef;
    if (sourceHash !== submission.source_snapshot_hash) {
      throw new Error(`submission source snapshot mismatch: ${submission.submission_id}`);
    }
    const commandHash = await readAgentCommandHash(submissionDir);
    if (submission.agent_command_hash !== commandHash) {
      throw new Error(`submission command identity mismatch: ${submission.submission_id}`);
    }
    const expectedFingerprint = computeSubmissionInputFingerprint({
      configuration_id: series.configuration_id as HashRef,
      agent_command_hash: submission.agent_command_hash as HashRef,
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash as HashRef,
      prompt_language: series.configuration.prompt_language,
      budget_seconds: task.manifest.budget_seconds,
      network_policy: task.manifest.network_policy,
      development_parameters: submission.development_parameters as
        SubmissionFingerprintInput["development_parameters"],
    });
    if (submission.development_input_fingerprint !== expectedFingerprint) {
      throw new Error(`submission input fingerprint mismatch: ${submission.submission_id}`);
    }
    const evidence = await verifyEvidenceManifest(submissionDir);
    if (!evidence.valid) throw new Error(evidence.errors.join("\n"));
    submissionsById.set(submission.submission_id, submission);
    submissionDirs.set(submission.submission_id, submissionDir);
  }

  const evaluationsBySubmission = new Map<string, LoadedV2Evaluation[]>();
  const aggregateInputs: Parameters<typeof aggregateEvaluationsV3>[0] = [];
  for (const reference of series.evaluations) {
    const evaluationDir = path.join(options.seriesDir, "evaluations", reference.run_id);
    const run = RunManifestV3Schema.parse(await readJson(path.join(evaluationDir, "run.json")));
    const submission = submissionsById.get(reference.submission_id);
    if (!submission) throw new Error(`evaluation references unknown submission: ${reference.run_id}`);
    assertEvaluationBinding(reference, run, series, submission);
    if (!run.exit_reason) throw new Error(`evaluation ${run.run_id} is not finished`);
    const score = await optionalParsed(path.join(evaluationDir, "score.json"), (input) =>
      ScoreResultSchema.parse(input));
    const task = context.tasksById.get(run.task_id);
    if (!task) throw new Error(`unknown evaluation task: ${run.task_id}`);
    if (score) {
      assertScoreResult(task.manifest, task.hash, score);
      const result = EvaluationResultSchema.parse(
        await readJson(path.join(evaluationDir, "evaluation-result.json")),
      );
      if (
        result.run_id !== run.run_id ||
        result.submission_id !== run.submission_id ||
        result.evaluation_seed !== run.evaluation_seed ||
        !sameJson(result.score, score)
      ) {
        throw new Error(`evaluation result does not match run ${run.run_id}`);
      }
    }
    if (reference.included && !score) {
      throw new Error(`included evaluation ${run.run_id} has no score`);
    }
    if (reference.included && score && task.manifest.track === board) {
      aggregateInputs.push({
        task: task.manifest,
        task_hash: task.hash,
        submission_id: submission.submission_id,
        evaluation_seed: run.evaluation_seed,
        score,
      });
    }
    const artifacts = task.manifest.track === board
      ? await evaluationArtifacts(evaluationDir, run, options.store)
      : [];
    if (task.manifest.track !== board) {
      const evidence = await verifyEvidenceManifest(evaluationDir);
      if (!evidence.valid) throw new Error(evidence.errors.join("\n"));
    }
    const group = evaluationsBySubmission.get(submission.submission_id) ?? [];
    group.push({ reference, run, ...(score ? { score } : {}), artifacts });
    evaluationsBySubmission.set(submission.submission_id, group);
  }
  if (aggregateInputs.length === 0) {
    throw new Error("publication requires at least one included scored evaluation");
  }

  const publishedSubmissions: PublicationManifestV2["submissions"] = [];
  for (const reference of series.submissions) {
    const submission = submissionsById.get(reference.submission_id);
    const submissionDir = submissionDirs.get(reference.submission_id);
    if (!submission || !submissionDir) throw new Error("missing loaded submission");
    const task = context.tasksById.get(submission.task_id);
    if (!task) throw new Error(`unknown submission task: ${submission.task_id}`);
    if (task.manifest.track !== board) continue;
    const loadedEvaluations = evaluationsBySubmission.get(submission.submission_id) ?? [];
    if (loadedEvaluations.length === 0) {
      throw new Error(`submission ${submission.submission_id} has no evaluations`);
    }
    const includedScores = loadedEvaluations
      .filter((evaluation): evaluation is LoadedV2Evaluation & { score: ScoreResult } =>
        evaluation.reference.included && evaluation.score !== undefined)
      .map((evaluation) => ({
        evaluation_seed: evaluation.run.evaluation_seed,
        score: evaluation.score,
      }));
    const reproduction = await optionalParsed(
      path.join(submissionDir, "reproduction.json"),
      (input) => ReproductionRecordV2Schema.parse(input),
    );
    const verification = await optionalParsed(
      path.join(submissionDir, "verification.json"),
      (input) => VerificationRecordV2Schema.parse(input),
    );
    if (reference.included && !reproduction) {
      throw new Error(`included submission ${submission.submission_id} was not reproduced`);
    }
    const artifacts = await submissionArtifacts(
      submissionDir,
      task,
      reference.included,
      options.store,
    );
    if (reproduction) {
      const source = artifacts.find((artifact) => artifact.role === "clean-source");
      const setHash = evaluationSetHash(includedScores);
      if (
        reproduction.benchmark_release_hash !== series.benchmark_release_hash ||
        reproduction.submission_id !== submission.submission_id ||
        !source ||
        reproduction.clean_source_artifact_id !== source.artifact_id ||
        reproduction.evaluation_set_hash !== setHash
      ) {
        throw new Error(`reproduction record does not match submission ${submission.submission_id}`);
      }
      if (verification) {
        const evidenceHash = `sha256:${await sha256File(path.join(submissionDir, "MANIFEST.sha256"))}`;
        if (
          verification.benchmark_release_hash !== series.benchmark_release_hash ||
          verification.git_commit !== series.configuration.environment.git_commit ||
          verification.submission_id !== submission.submission_id ||
          verification.clean_source_artifact_id !== reproduction.clean_source_artifact_id ||
          verification.evaluation_set_hash !== reproduction.evaluation_set_hash ||
          verification.evidence_manifest_hash !== evidenceHash
        ) {
          throw new Error(`verification record does not match submission ${submission.submission_id}`);
        }
        for (const evaluation of loadedEvaluations.filter((item) => item.reference.included)) {
          if (
            evaluation.run.environment.evaluator_image_digest !==
              verification.evaluator_image_digest
          ) {
            throw new Error(`verification evaluator image does not match evaluation ${evaluation.run.run_id}`);
          }
        }
      }
    } else if (verification) {
      throw new Error(`verification has no reproduction for submission ${submission.submission_id}`);
    }
    publishedSubmissions.push({
      submission_id: submission.submission_id,
      development_input_fingerprint: submission.development_input_fingerprint,
      agent_command_hash: submission.agent_command_hash,
      development_parameters: submission.development_parameters,
      source_snapshot_hash: submission.source_snapshot_hash,
      task_id: submission.task_id,
      task_version: submission.task_version,
      task_hash: submission.task_hash,
      agent_invocation_index: submission.agent_invocation_index,
      included: reference.included,
      network_policy: submission.network_policy,
      development_exit_reason: submission.development_exit_reason,
      ...(submission.usage ? { usage: submission.usage } : {}),
      artifacts,
      ...(reproduction ? { reproduction } : {}),
      ...(verification ? { verification } : {}),
      evaluations: loadedEvaluations.map((evaluation) => ({
        run_id: evaluation.run.run_id,
        input_fingerprint: evaluation.run.input_fingerprint,
        evaluation_seed: evaluation.run.evaluation_seed,
        included: evaluation.reference.included,
        exit_reason: evaluation.run.exit_reason!,
        ...(evaluation.score ? { score: evaluation.score } : {}),
        ...(evaluation.run.wall_time_ms === undefined
          ? {}
          : { wall_time_ms: evaluation.run.wall_time_ms }),
        artifacts: evaluation.artifacts,
      })),
    });
  }

  const aggregate = aggregateEvaluationsV3(
    aggregateInputs,
    context.releaseTasks
      .filter((task) => task.manifest.track === board)
      .map((task) => ({ task: task.manifest, task_hash: task.hash })),
    context.lock.official.evaluation_seeds,
  );
  const payload: Omit<PublicationManifestV2, "publication_id"> = {
    schema_version: 2,
    created_at: series.created_at,
    tier: options.tier,
    board,
    series_id: series.series_id,
    benchmark: {
      version: series.benchmark_version,
      release_hash: series.benchmark_release_hash,
      git_commit: series.git_commit,
    },
    configuration: {
      configuration_id: series.configuration_id,
      ...series.configuration,
    },
    aggregate,
    submissions: publishedSubmissions,
    review_summaries: [],
  };
  const publication = PublicationManifestV2Schema.parse({
    ...payload,
    publication_id: computePublicationId(payload),
  });
  if (options.tier === "official") {
    assertOfficialEligibilityV2(publication, context.lock);
  }
  return publication;
}

export interface PublishSeriesOptions {
  repositoryRoot: string;
  seriesDir: string;
  resultsRoot: string;
  tier: "experimental" | "official";
  board?: "build" | "reproduce";
  store: ArtifactStore;
  supersedes?: HashRef;
}

async function persistPublication(
  options: PublishSeriesOptions,
  publication: AnyPublicationManifest,
): Promise<void> {
  const publicationPath = path.join(
    options.resultsRoot,
    "publications",
    `${publication.publication_id.slice("sha256:".length)}.json`,
  );
  if (await exists(publicationPath)) {
    throw new Error(`publication already exists: ${publication.publication_id}`);
  }
  const indexPath = path.join(options.resultsRoot, "index.json");
  const rawIndex: AnyResultIndex = (await exists(indexPath))
    ? AnyResultIndexSchema.parse(await readJson(indexPath))
    : publication.schema_version === 2
      ? { schema_version: 2, generated_at: new Date(0).toISOString(), benchmark_versions: [], entries: [] }
      : { schema_version: 1, generated_at: new Date(0).toISOString(), benchmark_versions: [], entries: [] };
  if (rawIndex.entries.some((entry) => entry.publication_id === publication.publication_id)) {
    throw new Error(`result index already contains ${publication.publication_id}`);
  }
  const index = asJson(rawIndex) as unknown as {
    schema_version: 1 | 2;
    generated_at: string;
    benchmark_versions: string[];
    entries: Array<Record<string, unknown> & {
      publication_id: string;
      created_at: string;
      benchmark_version: string;
      status: "active" | "superseded" | "withdrawn";
      superseded_by?: string;
    }>;
  };
  if (publication.schema_version === 2) index.schema_version = 2;
  if (index.schema_version === 2) {
    index.entries = index.entries.map((entry) => ({
      publication_schema_version: "publication_schema_version" in entry
        ? entry.publication_schema_version
        : 1,
      ...entry,
    }));
  }
  if (options.supersedes) {
    const prior = index.entries.find((entry) => entry.publication_id === options.supersedes);
    if (!prior) throw new Error(`cannot supersede unknown publication ${options.supersedes}`);
    prior.status = "superseded";
    prior.superseded_by = publication.publication_id;
  }
  index.entries.push({
    ...(index.schema_version === 2
      ? { publication_schema_version: publication.schema_version }
      : {}),
    publication_id: publication.publication_id,
    created_at: publication.created_at,
    tier: publication.tier,
    status: "active",
    benchmark_version: publication.benchmark.version,
    series_id: publication.series_id,
    configuration_id: publication.configuration.configuration_id,
    agent: publication.configuration.agent,
    ...(publication.schema_version === 2 ? { board: publication.board } : {}),
    aggregate: publication.aggregate,
  });
  index.entries.sort((left, right) => right.created_at.localeCompare(left.created_at));
  index.generated_at = new Date().toISOString();
  index.benchmark_versions = [...new Set(index.entries.map((entry) => entry.benchmark_version))]
    .sort((left, right) => compareSemanticVersions(right, left));
  const parsedIndex = AnyResultIndexSchema.parse(index);
  await writeJson(publicationPath, publication);
  await writeJson(indexPath, parsedIndex);
}

export async function publishSeries(
  options: PublishSeriesOptions,
): Promise<AnyPublicationManifest> {
  const series = AnySeriesManifestSchema.parse(
    await readJson(path.join(options.seriesDir, "series.json")),
  );
  const context = await loadReleaseContext(options.repositoryRoot, series.benchmark_version);
  if (series.benchmark_release_hash !== context.releaseHash) {
    throw new Error("series benchmark release hash does not match the release lock");
  }
  const publication = series.schema_version === 1
    ? await publishLegacySeries(options, series, context)
    : await publishV2Series(options, series, context);
  await persistPublication(options, publication);
  return publication;
}

function assertLegacyPublicationSemantics(
  publication: PublicationManifestV1,
  context: ReleaseContext,
): void {
  if (context.lock.schema_version === 3) {
    throw new Error("legacy publication requires a v1 or v2 release lock");
  }
  const expectedConfigurationId = configurationIdFor(
    publication.benchmark.version,
    publication.benchmark.release_hash,
    publication.configuration,
  );
  if (publication.configuration.configuration_id !== expectedConfigurationId) {
    throw new Error(`publication configuration ID mismatch: ${publication.publication_id}`);
  }
  if (publication.benchmark.git_commit !== publication.configuration.environment.git_commit) {
    throw new Error(`publication Git commit mismatch: ${publication.publication_id}`);
  }
  const inputs: Array<{ task: LoadedTask["manifest"]; score: ScoreResult }> = [];
  for (const run of publication.runs) {
    const task = context.tasksById.get(run.task_id);
    if (
      !task || task.hash !== run.task_hash || task.manifest.version !== run.task_version ||
      task.manifest.network_policy !== run.network_policy
    ) {
      throw new Error(`publication run is outside release ${context.lock.benchmark_version}: ${run.run_id}`);
    }
    const expectedFingerprint = legacyInputFingerprint(
      publication.configuration.configuration_id,
      task,
      run.seed,
      publication.configuration.prompt_language,
    );
    if (run.input_fingerprint !== expectedFingerprint) {
      throw new Error(`publication run input fingerprint mismatch: ${run.run_id}`);
    }
    if (run.score) assertScoreResult(task.manifest, task.hash, run.score);
    if (run.included) {
      if (!run.score) throw new Error(`included run ${run.run_id} has no score`);
      inputs.push({ task: task.manifest, score: run.score });
    }
    if (task.manifest.track === "reproduce" && run.score &&
      !run.artifacts.some((artifact) => artifact.role === "license")) {
      throw new Error(`reproduce run ${run.run_id} has no published license artifact`);
    }
    if (run.score) {
      const source = run.artifacts.find((artifact) => artifact.role === "clean-source");
      const expectedScoreHash = sha256Canonical(scoreResultIdentity(run.score));
      if (
        !run.reproduction || !source ||
        source.artifact_id !== run.reproduction.clean_source_artifact_id ||
        run.reproduction.benchmark_release_hash !== publication.benchmark.release_hash ||
        run.reproduction.recomputed_score_hash !== expectedScoreHash
      ) {
        throw new Error(`invalid reproduction record in run ${run.run_id}`);
      }
      if (run.verification && (
        run.verification.benchmark_release_hash !== publication.benchmark.release_hash ||
        run.verification.git_commit !== publication.configuration.environment.git_commit ||
        run.verification.clean_source_artifact_id !== run.reproduction.clean_source_artifact_id ||
        run.verification.recomputed_score_hash !== run.reproduction.recomputed_score_hash
      )) {
        throw new Error(`invalid verification record in run ${run.run_id}`);
      }
    }
  }
  const aggregateSchemaVersion = context.lock.schema_version === 1
    ? 1
    : context.lock.scoring.aggregate;
  const expectedAggregate = legacyAggregate(
    inputs,
    context.releaseTasks,
    aggregateSchemaVersion,
  );
  assertSameJson(
    publication.aggregate,
    expectedAggregate,
    `publication aggregate does not match included runs: ${publication.publication_id}`,
  );
  if (publication.tier === "official") {
    if (context.lock.schema_version !== 2) {
      throw new Error("release lock v1 does not define Official eligibility");
    }
    assertOfficialEligibility(
      publication,
      context.lock,
      publication.configuration.environment.source_tree_dirty,
    );
  }
}

function assertV2PublicationSemantics(
  publication: PublicationManifestV2,
  context: ReleaseContext,
): void {
  if (context.lock.schema_version !== 3) {
    throw new Error("publication v2 requires a v3 release lock");
  }
  const expectedConfigurationId = configurationIdFor(
    publication.benchmark.version,
    publication.benchmark.release_hash,
    publication.configuration,
  );
  if (publication.configuration.configuration_id !== expectedConfigurationId) {
    throw new Error(`publication configuration ID mismatch: ${publication.publication_id}`);
  }
  if (publication.benchmark.git_commit !== publication.configuration.environment.git_commit) {
    throw new Error(`publication Git commit mismatch: ${publication.publication_id}`);
  }
  const aggregateInputs: Parameters<typeof aggregateEvaluationsV3>[0] = [];
  for (const submission of publication.submissions) {
    const task = context.tasksById.get(submission.task_id);
    if (
      !task || task.hash !== submission.task_hash ||
      task.manifest.version !== submission.task_version ||
      task.manifest.track !== publication.board ||
      task.manifest.network_policy !== submission.network_policy
    ) {
      throw new Error(`publication submission is outside release: ${submission.submission_id}`);
    }
    const expectedDevelopmentFingerprint = computeSubmissionInputFingerprint({
      configuration_id: publication.configuration.configuration_id as HashRef,
      agent_command_hash: submission.agent_command_hash as HashRef,
      task_id: task.manifest.id,
      task_version: task.manifest.version,
      task_hash: task.hash as HashRef,
      prompt_language: publication.configuration.prompt_language,
      budget_seconds: task.manifest.budget_seconds,
      network_policy: task.manifest.network_policy,
      development_parameters: submission.development_parameters as
        SubmissionFingerprintInput["development_parameters"],
    });
    if (submission.development_input_fingerprint !== expectedDevelopmentFingerprint) {
      throw new Error(`submission input fingerprint mismatch: ${submission.submission_id}`);
    }
    const includedScores: Array<{ evaluation_seed: number; score: ScoreResult }> = [];
    for (const evaluation of submission.evaluations) {
      const expectedFingerprint = computeEvaluationInputFingerprint({
        benchmark_release_hash: publication.benchmark.release_hash as HashRef,
        configuration_id: publication.configuration.configuration_id as HashRef,
        submission_id: submission.submission_id,
        source_snapshot_hash: submission.source_snapshot_hash as HashRef,
        task_id: submission.task_id,
        task_version: submission.task_version,
        task_hash: submission.task_hash as HashRef,
        evaluation_seed: evaluation.evaluation_seed,
        ...(publication.configuration.environment.evaluator_image_digest
          ? { evaluator_image_digest: publication.configuration.environment.evaluator_image_digest as HashRef }
          : {}),
      });
      if (evaluation.input_fingerprint !== expectedFingerprint) {
        throw new Error(`evaluation input fingerprint mismatch: ${evaluation.run_id}`);
      }
      if (!evaluation.artifacts.some((artifact) => artifact.role === "evidence")) {
        throw new Error(`evaluation ${evaluation.run_id} has no evidence artifact`);
      }
      if (evaluation.score) assertScoreResult(task.manifest, task.hash, evaluation.score);
      if (evaluation.included) {
        if (!submission.included || !evaluation.score) {
          throw new Error(`included evaluation is invalid: ${evaluation.run_id}`);
        }
        includedScores.push({ evaluation_seed: evaluation.evaluation_seed, score: evaluation.score });
        aggregateInputs.push({
          task: task.manifest,
          task_hash: task.hash,
          submission_id: submission.submission_id,
          evaluation_seed: evaluation.evaluation_seed,
          score: evaluation.score,
        });
      }
    }
    if (submission.included && !submission.reproduction) {
      throw new Error(`included submission ${submission.submission_id} has no reproduction`);
    }
    if (submission.reproduction) {
      const source = submission.artifacts.find((artifact) => artifact.role === "clean-source");
      const setHash = evaluationSetHash(includedScores);
      if (
        !source ||
        submission.reproduction.benchmark_release_hash !== publication.benchmark.release_hash ||
        submission.reproduction.submission_id !== submission.submission_id ||
        submission.reproduction.clean_source_artifact_id !== source.artifact_id ||
        submission.reproduction.evaluation_set_hash !== setHash
      ) {
        throw new Error(`invalid reproduction record in submission ${submission.submission_id}`);
      }
      if (submission.verification && (
        submission.verification.benchmark_release_hash !== publication.benchmark.release_hash ||
        submission.verification.git_commit !== publication.configuration.environment.git_commit ||
        submission.verification.submission_id !== submission.submission_id ||
        submission.verification.clean_source_artifact_id !== submission.reproduction.clean_source_artifact_id ||
        submission.verification.evaluation_set_hash !== submission.reproduction.evaluation_set_hash ||
        (publication.configuration.environment.evaluator_image_digest !== undefined &&
          submission.verification.evaluator_image_digest !==
            publication.configuration.environment.evaluator_image_digest)
      )) {
        throw new Error(`invalid verification record in submission ${submission.submission_id}`);
      }
    } else if (submission.verification) {
      throw new Error(`verification has no reproduction in submission ${submission.submission_id}`);
    }
    if (task.manifest.track === "reproduce" && submission.included &&
      !submission.artifacts.some((artifact) => artifact.role === "license")) {
      throw new Error(`reproduce submission ${submission.submission_id} has no license`);
    }
  }
  const expectedAggregate = aggregateEvaluationsV3(
    aggregateInputs,
    context.releaseTasks
      .filter((task) => task.manifest.track === publication.board)
      .map((task) => ({ task: task.manifest, task_hash: task.hash })),
    context.lock.official.evaluation_seeds,
  );
  assertSameJson(
    publication.aggregate,
    expectedAggregate,
    `publication aggregate does not match included evaluations: ${publication.publication_id}`,
  );
  if (publication.tier === "official") {
    assertOfficialEligibilityV2(publication, context.lock);
  }
}

async function verifyArtifactRefs(
  publication: AnyPublicationManifest,
  store: ArtifactStore | undefined,
): Promise<number> {
  const refs = publication.schema_version === 1
    ? publication.runs.flatMap((run) => run.artifacts)
    : publication.submissions.flatMap((submission) => [
        ...submission.artifacts,
        ...submission.evaluations.flatMap((evaluation) => evaluation.artifacts),
      ]);
  for (const artifact of refs) {
    if (store) {
      const expectedUrl = store.resolveUrl(
        artifact.artifact_id as HashRef,
        artifact.file_name,
        artifact.role,
      );
      if (artifact.url !== expectedUrl) {
        throw new Error(`published artifact URL mismatch: ${artifact.artifact_id}`);
      }
      if (!(await store.exists(artifact))) {
        throw new Error(`missing published artifact: ${artifact.artifact_id}`);
      }
    }
  }
  return refs.length;
}

export async function verifyResultsRepository(
  resultsRoot: string,
  store?: ArtifactStore,
  repositoryRoot?: string,
): Promise<{ publications: number; artifacts: number }> {
  const index = AnyResultIndexSchema.parse(await readJson(path.join(resultsRoot, "index.json")));
  const seen = new Set<string>();
  const entriesById = new Map(index.entries.map((entry) => [entry.publication_id, entry]));
  const contexts = new Map<string, ReleaseContext>();
  let artifactCount = 0;
  for (const entry of index.entries) {
    if (seen.has(entry.publication_id)) {
      throw new Error(`duplicate result index entry: ${entry.publication_id}`);
    }
    seen.add(entry.publication_id);
    const publication = verifyPublicationIdentity(await readJson(path.join(
      resultsRoot,
      "publications",
      `${entry.publication_id.slice("sha256:".length)}.json`,
    )));
    if (
      publication.benchmark.version !== entry.benchmark_version ||
      publication.series_id !== entry.series_id ||
      publication.configuration.configuration_id !== entry.configuration_id ||
      publication.tier !== entry.tier ||
      ("publication_schema_version" in entry &&
        entry.publication_schema_version !== publication.schema_version) ||
      (publication.schema_version === 2 &&
        (!("board" in entry) || entry.board !== publication.board))
    ) {
      throw new Error(`result index metadata mismatch: ${entry.publication_id}`);
    }
    assertSameJson(
      publication.aggregate,
      entry.aggregate,
      `result index aggregate mismatch: ${entry.publication_id}`,
    );
    if (repositoryRoot) {
      let context = contexts.get(publication.benchmark.version);
      if (!context) {
        context = await loadReleaseContext(
          repositoryRoot,
          publication.benchmark.version,
          publication.benchmark.release_hash,
        );
        contexts.set(publication.benchmark.version, context);
      }
      if (context.releaseHash !== publication.benchmark.release_hash) {
        throw new Error(`publication release hash mismatch: ${entry.publication_id}`);
      }
      if (publication.schema_version === 1) {
        assertLegacyPublicationSemantics(publication, context);
      } else {
        assertV2PublicationSemantics(publication, context);
      }
    }
    artifactCount += await verifyArtifactRefs(publication, store);
  }
  for (const entry of index.entries) {
    if (entry.status === "superseded") {
      if (!entry.superseded_by || !entriesById.has(entry.superseded_by)) {
        throw new Error(`superseded result has no indexed replacement: ${entry.publication_id}`);
      }
    } else if (entry.superseded_by) {
      throw new Error(`only superseded results may name superseded_by: ${entry.publication_id}`);
    }
  }
  const expectedVersions = [...new Set(index.entries.map((entry) => entry.benchmark_version))]
    .sort((left, right) => compareSemanticVersions(right, left));
  if (JSON.stringify(expectedVersions) !== JSON.stringify(index.benchmark_versions)) {
    throw new Error("result index benchmark_versions is stale or unsorted");
  }
  const publicationsRoot = path.join(resultsRoot, "publications");
  const publicationFiles = (await exists(publicationsRoot))
    ? (await readdir(publicationsRoot)).filter((file) => file.endsWith(".json")).sort()
    : [];
  const expectedFiles = [...seen]
    .map((publicationId) => `${publicationId.slice("sha256:".length)}.json`)
    .sort();
  if (JSON.stringify(publicationFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("publication directory and result index are inconsistent");
  }
  return { publications: index.entries.length, artifacts: artifactCount };
}
