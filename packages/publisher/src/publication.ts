import {
  access,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  AggregateResultSchema,
  PublicationManifestSchema,
  ReleaseLockSchema,
  ResultIndexSchema,
  ReproductionRecordSchema,
  RunManifestV2Schema,
  ScoreResultSchema,
  SeriesManifestSchema,
  VerificationRecordSchema,
  aggregateAttempts,
  compareSemanticVersions,
  listTasks,
  scoreResultIdentity,
  sha256Canonical,
  sha256File,
  verifyEvidenceManifest,
  writeJson,
  type ArtifactRef,
  type JsonValue,
  type PublicationManifest,
  type ReproductionRecord,
  type ReleaseLockV2,
  type ResultIndex,
  type RunManifestV2,
  type ScoreResult,
  type VerificationRecord,
} from "@carrick/gamebench-core";
import type { ArtifactStore } from "./store.js";

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

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function computePublicationId(
  publication: Omit<PublicationManifest, "publication_id">,
): `sha256:${string}` {
  return sha256Canonical(asJson(publication));
}

export function verifyPublicationIdentity(
  input: unknown,
): PublicationManifest {
  const publication = PublicationManifestSchema.parse(input);
  const { publication_id: claimed, ...payload } = publication;
  const actual = computePublicationId(payload);
  if (actual !== claimed) {
    throw new Error(
      `publication ID mismatch: expected ${actual}, received ${claimed}`,
    );
  }
  return publication;
}

function officialCells(lock: ReleaseLockV2): Set<string> {
  return new Set(
    lock.tasks.flatMap((task) =>
      lock.official.seeds.map((seed) => `${task.id}\0${seed}`),
    ),
  );
}

export function assertOfficialEligibility(
  publication: PublicationManifest,
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
    if (!run.included) {
      continue;
    }
    const key = `${run.task_id}\0${run.seed}`;
    included.set(key, (included.get(key) ?? 0) + 1);
    if (!run.score) {
      throw new Error(`official run ${run.run_id} has no score`);
    }
    if (
      run.exit_reason !== "completed" &&
      run.exit_reason !== "timeout"
    ) {
      throw new Error(
        `official run ${run.run_id} has invalid exit reason ${run.exit_reason}`,
      );
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
      run.verification.network_attestation !==
        "operator-attested-model-api-only"
    ) {
      throw new Error(
        `official run ${run.run_id} requires model-api-only network attestation`,
      );
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
}

async function publicArtifacts(
  runDir: string,
  run: RunManifestV2,
  taskRoot: string,
  store: ArtifactStore,
): Promise<ArtifactRef[]> {
  const outputRoot = path.join(runDir, "public");
  const sourceArchive = path.join(outputRoot, "clean-source.tar.zst");
  const playable = path.join(outputRoot, "playable");
  if (!(await exists(sourceArchive)) || !(await exists(path.join(playable, "index.html")))) {
    throw new Error(`run ${run.run_id} has not been prepared for publication`);
  }
  const evidence = await verifyEvidenceManifest(runDir);
  if (!evidence.valid) {
    throw new Error(evidence.errors.join("\n"));
  }
  const artifacts: ArtifactRef[] = [
    await store.put(sourceArchive, {
      role: "clean-source",
      fileName: "clean-source.tar.zst",
      mediaType: "application/zstd",
    }),
    await store.put(playable, {
      role: "playable",
      fileName: "index.html",
      mediaType: "text/html",
      kind: "directory",
    }),
  ];
  const showcase = path.join(outputRoot, "showcase.png");
  if (!(await exists(showcase))) {
    throw new Error(`run ${run.run_id} has no deterministic showcase`);
  }
  artifacts.push(
    await store.put(showcase, {
      role: "screenshot",
      fileName:
        `${run.task_id.replace(/[^a-zA-Z0-9._-]+/g, "-")}-showcase.png`,
      mediaType: "image/png",
    }),
  );
  const screenshots = await findPngFiles(path.join(runDir, "playwright"));
  for (const [index, screenshot] of screenshots.entries()) {
    artifacts.push(
      await store.put(screenshot, {
        role: "screenshot",
        fileName: `${run.task_id.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${index + 1}.png`,
        mediaType: "image/png",
      }),
    );
  }
  const thirdParty = path.join(taskRoot, "THIRD_PARTY.yml");
  if (await exists(thirdParty)) {
    artifacts.push(
      await store.put(thirdParty, {
        role: "license",
        fileName: "THIRD_PARTY.yml",
        mediaType: "text/yaml",
      }),
    );
  }
  return artifacts;
}

async function loadVerification(
  runDir: string,
): Promise<VerificationRecord | undefined> {
  const verificationPath = path.join(runDir, "verification.json");
  if (!(await exists(verificationPath))) {
    return undefined;
  }
  return VerificationRecordSchema.parse(await readJson(verificationPath));
}

async function loadReproduction(
  runDir: string,
): Promise<ReproductionRecord | undefined> {
  const reproductionPath = path.join(runDir, "reproduction.json");
  if (!(await exists(reproductionPath))) {
    return undefined;
  }
  return ReproductionRecordSchema.parse(await readJson(reproductionPath));
}

async function loadScore(runDir: string): Promise<ScoreResult | undefined> {
  const scorePath = path.join(runDir, "score.json");
  if (!(await exists(scorePath))) {
    return undefined;
  }
  return ScoreResultSchema.parse(await readJson(scorePath));
}

async function wallTime(runDir: string): Promise<number | undefined> {
  const telemetryPath = path.join(runDir, "telemetry.json");
  if (!(await exists(telemetryPath))) {
    return undefined;
  }
  const telemetry = await readJson(telemetryPath) as { wall_time_ms?: unknown };
  return typeof telemetry.wall_time_ms === "number"
    ? telemetry.wall_time_ms
    : undefined;
}

export interface PublishSeriesOptions {
  repositoryRoot: string;
  seriesDir: string;
  resultsRoot: string;
  tier: "experimental" | "official";
  store: ArtifactStore;
  supersedes?: `sha256:${string}`;
}

export async function publishSeries(
  options: PublishSeriesOptions,
): Promise<PublicationManifest> {
  const series = SeriesManifestSchema.parse(
    await readJson(path.join(options.seriesDir, "series.json")),
  );
  const lockPath = path.join(
    options.repositoryRoot,
    "benchmark",
    "releases",
    `${series.benchmark_version}.json`,
  );
  const lock = ReleaseLockSchema.parse(await readJson(lockPath));
  if (lock.schema_version !== 2) {
    throw new Error("v2 publication requires a v2 benchmark release lock");
  }
  const releaseHash = `sha256:${await sha256File(lockPath)}` as const;
  if (series.benchmark_release_hash !== releaseHash) {
    throw new Error("series benchmark release hash does not match the release lock");
  }

  const tasks = await listTasks(options.repositoryRoot);
  const tasksById = new Map(tasks.map((task) => [task.manifest.id, task]));
  const publishedRuns: PublicationManifest["runs"] = [];
  const aggregateInputs: Array<{
    task: (typeof tasks)[number]["manifest"];
    score: ScoreResult;
  }> = [];

  for (const reference of series.runs) {
    const runDir = path.join(options.seriesDir, reference.run_id);
    const run = RunManifestV2Schema.parse(await readJson(path.join(runDir, "run.json")));
    if (
      run.series_id !== series.series_id ||
      run.configuration_id !== series.configuration_id ||
      run.task_id !== reference.task_id ||
      run.task_hash !== reference.task_hash ||
      run.seed !== reference.seed
    ) {
      throw new Error(`series reference does not match run ${reference.run_id}`);
    }
    if (!run.exit_reason) {
      throw new Error(`run ${run.run_id} is not finished`);
    }
    const task = tasksById.get(run.task_id);
    if (!task || task.hash !== run.task_hash) {
      throw new Error(`run ${run.run_id} does not match the current task catalog`);
    }
    const score = await loadScore(runDir);
    if (score && (score.task_id !== run.task_id || score.task_hash !== run.task_hash)) {
      throw new Error(`score does not match run ${run.run_id}`);
    }
    if (reference.included && !score) {
      throw new Error(`included run ${run.run_id} has no score`);
    }
    if (reference.included && score) {
      aggregateInputs.push({ task: task.manifest, score });
    }

    const reproduction = await loadReproduction(runDir);
    if (score && !reproduction) {
      throw new Error(`scored run ${run.run_id} was not rebuilt from clean source`);
    }
    const artifacts = score
      ? await publicArtifacts(runDir, run, task.root, options.store)
      : [];
    const verification = await loadVerification(runDir);
    if (score && reproduction) {
      const sourceArtifact = artifacts.find(
        (artifact) => artifact.role === "clean-source",
      );
      const scoreHash = sha256Canonical(scoreResultIdentity(score));
      if (
        !sourceArtifact ||
        sourceArtifact.artifact_id !== reproduction.clean_source_artifact_id ||
        reproduction.benchmark_release_hash !== run.benchmark_release_hash ||
        reproduction.recomputed_score_hash !== scoreHash
      ) {
        throw new Error(`reproduction record does not match run ${run.run_id}`);
      }
      if (verification) {
        const evidenceHash =
          `sha256:${await sha256File(path.join(runDir, "MANIFEST.sha256"))}`;
        if (
          verification.benchmark_release_hash !== run.benchmark_release_hash ||
          verification.git_commit !== run.environment.git_commit ||
          verification.clean_source_artifact_id !==
            reproduction.clean_source_artifact_id ||
          verification.recomputed_score_hash !==
            reproduction.recomputed_score_hash ||
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

  const aggregate = AggregateResultSchema.parse(
    aggregateAttempts(
      aggregateInputs,
      lock.tasks.map((task) => {
        const loaded = tasksById.get(task.id);
        if (!loaded || loaded.hash !== task.hash) {
          throw new Error(`release task is unavailable from this checkout: ${task.id}`);
        }
        return loaded.manifest;
      }),
    ),
  );
  if (aggregate.schema_version !== lock.scoring.aggregate) {
    throw new Error(
      `generated aggregate schema ${aggregate.schema_version} does not match ` +
        `release ${lock.scoring.aggregate}`,
    );
  }
  const payload: Omit<PublicationManifest, "publication_id"> = {
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
      agent: series.configuration.agent,
      prompt_language: series.configuration.prompt_language,
      execution_profile: series.configuration.execution_profile,
      environment: series.configuration.environment,
    },
    aggregate,
    runs: publishedRuns,
    review_summaries: [],
  };
  const publication = PublicationManifestSchema.parse({
    ...payload,
    publication_id: computePublicationId(payload),
  });
  if (options.tier === "official") {
    assertOfficialEligibility(
      publication,
      lock,
      series.configuration.environment.source_tree_dirty,
    );
  }

  const publicationsDir = path.join(options.resultsRoot, "publications");
  const publicationPath = path.join(
    publicationsDir,
    `${publication.publication_id.slice("sha256:".length)}.json`,
  );
  if (await exists(publicationPath)) {
    throw new Error(`publication already exists: ${publication.publication_id}`);
  }

  const indexPath = path.join(options.resultsRoot, "index.json");
  const index: ResultIndex = (await exists(indexPath))
    ? ResultIndexSchema.parse(await readJson(indexPath))
    : {
        schema_version: 1,
        generated_at: new Date(0).toISOString(),
        benchmark_versions: [],
        entries: [],
      };
  if (index.entries.some((entry) => entry.publication_id === publication.publication_id)) {
    throw new Error(`result index already contains ${publication.publication_id}`);
  }
  if (options.supersedes) {
    const prior = index.entries.find(
      (entry) => entry.publication_id === options.supersedes,
    );
    if (!prior) {
      throw new Error(`cannot supersede unknown publication ${options.supersedes}`);
    }
    prior.status = "superseded";
    prior.superseded_by = publication.publication_id;
  }
  index.entries.push({
    publication_id: publication.publication_id,
    created_at: publication.created_at,
    tier: publication.tier,
    status: "active",
    benchmark_version: publication.benchmark.version,
    series_id: publication.series_id,
    configuration_id: publication.configuration.configuration_id,
    agent: publication.configuration.agent,
    aggregate: publication.aggregate,
  });
  index.entries.sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
  index.generated_at = new Date().toISOString();
  index.benchmark_versions = [
    ...new Set(index.entries.map((entry) => entry.benchmark_version)),
  ].sort((left, right) => compareSemanticVersions(right, left));

  await writeJson(publicationPath, publication);
  await writeJson(indexPath, ResultIndexSchema.parse(index));
  return publication;
}

export async function verifyResultsRepository(
  resultsRoot: string,
  store?: ArtifactStore,
  repositoryRoot?: string,
): Promise<{ publications: number; artifacts: number }> {
  const index = ResultIndexSchema.parse(
    await readJson(path.join(resultsRoot, "index.json")),
  );
  const seen = new Set<string>();
  const entriesById = new Map(
    index.entries.map((entry) => [entry.publication_id, entry]),
  );
  let artifactCount = 0;
  for (const entry of index.entries) {
    if (seen.has(entry.publication_id)) {
      throw new Error(`duplicate result index entry: ${entry.publication_id}`);
    }
    seen.add(entry.publication_id);
    const publication = verifyPublicationIdentity(
      await readJson(
        path.join(
          resultsRoot,
          "publications",
          `${entry.publication_id.slice("sha256:".length)}.json`,
        ),
      ),
    );
    if (
      publication.benchmark.version !== entry.benchmark_version ||
      publication.series_id !== entry.series_id ||
      publication.configuration.configuration_id !== entry.configuration_id ||
      publication.tier !== entry.tier
    ) {
      throw new Error(`result index metadata mismatch: ${entry.publication_id}`);
    }
    if (
      sha256Canonical(asJson(publication.aggregate)) !==
      sha256Canonical(asJson(entry.aggregate))
    ) {
      throw new Error(`result index aggregate mismatch: ${entry.publication_id}`);
    }
    if (repositoryRoot) {
      const lockPath = path.join(
        repositoryRoot,
        "benchmark",
        "releases",
        `${publication.benchmark.version}.json`,
      );
      const releaseHash = `sha256:${await sha256File(lockPath)}`;
      if (releaseHash !== publication.benchmark.release_hash) {
        throw new Error(`publication release hash mismatch: ${entry.publication_id}`);
      }
      const lock = ReleaseLockSchema.parse(await readJson(lockPath));
      const releaseTasks = new Map(
        lock.tasks.map((task) => [task.id, task]),
      );
      for (const run of publication.runs) {
        const releaseTask = releaseTasks.get(run.task_id);
        if (
          !releaseTask ||
          releaseTask.version !== run.task_version ||
          releaseTask.hash !== run.task_hash
        ) {
          throw new Error(
            `publication run is outside release ${lock.benchmark_version}: ${run.run_id}`,
          );
        }
        if (
          releaseTask.track === "reproduce" &&
          run.score &&
          !run.artifacts.some((artifact) => artifact.role === "license")
        ) {
          throw new Error(
            `reproduce run ${run.run_id} has no published license artifact`,
          );
        }
      }
      if (
        lock.schema_version === 2 &&
        publication.aggregate.schema_version !== lock.scoring.aggregate
      ) {
        throw new Error(
          `publication aggregate schema mismatch: ${entry.publication_id}`,
        );
      }
      if (publication.tier === "official") {
        if (lock.schema_version !== 2) {
          throw new Error("official v2 publication requires a v2 release lock");
        }
        assertOfficialEligibility(
          publication,
          lock,
          publication.configuration.environment.source_tree_dirty,
        );
      }
    }
    for (const run of publication.runs) {
      if (run.score) {
        const source = run.artifacts.find(
          (artifact) => artifact.role === "clean-source",
        );
        const expectedScoreHash = sha256Canonical(
          scoreResultIdentity(run.score),
        );
        if (
          !run.reproduction ||
          !source ||
          source.artifact_id !== run.reproduction.clean_source_artifact_id ||
          run.reproduction.benchmark_release_hash !==
            publication.benchmark.release_hash ||
          run.reproduction.recomputed_score_hash !== expectedScoreHash
        ) {
          throw new Error(`invalid reproduction record in run ${run.run_id}`);
        }
        if (
          run.verification &&
          (
            run.verification.benchmark_release_hash !==
              publication.benchmark.release_hash ||
            run.verification.git_commit !==
              publication.configuration.environment.git_commit ||
            run.verification.clean_source_artifact_id !==
              run.reproduction.clean_source_artifact_id ||
            run.verification.recomputed_score_hash !==
              run.reproduction.recomputed_score_hash
          )
        ) {
          throw new Error(`invalid verification record in run ${run.run_id}`);
        }
      }
      for (const artifact of run.artifacts) {
        artifactCount += 1;
        if (store && !(await store.exists(artifact))) {
          throw new Error(`missing published artifact: ${artifact.artifact_id}`);
        }
      }
    }
  }
  for (const entry of index.entries) {
    if (entry.status === "superseded") {
      if (
        !entry.superseded_by ||
        !entriesById.has(entry.superseded_by)
      ) {
        throw new Error(
          `superseded result has no indexed replacement: ${entry.publication_id}`,
        );
      }
    } else if (entry.superseded_by) {
      throw new Error(
        `only superseded results may name superseded_by: ${entry.publication_id}`,
      );
    }
  }
  const expectedVersions = [
    ...new Set(index.entries.map((entry) => entry.benchmark_version)),
  ].sort((left, right) => compareSemanticVersions(right, left));
  if (
    JSON.stringify(expectedVersions) !==
    JSON.stringify(index.benchmark_versions)
  ) {
    throw new Error("result index benchmark_versions is stale or unsorted");
  }
  const publicationsRoot = path.join(resultsRoot, "publications");
  const publicationFiles = (await exists(publicationsRoot))
    ? (await readdir(publicationsRoot))
        .filter((file) => file.endsWith(".json"))
        .sort()
    : [];
  const expectedFiles = [...seen]
    .map((publicationId) => `${publicationId.slice("sha256:".length)}.json`)
    .sort();
  if (JSON.stringify(publicationFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("publication directory and result index are inconsistent");
  }
  return { publications: index.entries.length, artifacts: artifactCount };
}
