import {
  AnyPublicationManifestSchema,
  AnyReleaseLockSchema,
  AnyResultIndexSchema,
  LiteReleaseLockSchema,
  LiteResultIndexSchema,
  LiteSeriesResultSchema,
  compareSemanticVersions,
  findRepositoryRoot,
  listTasks,
  resolveReleasedTasks,
  sha256Canonical,
  sha256File,
  type JsonValue,
  type AnyReleaseLock,
  type LiteReleaseLock,
  type ReleasedTask,
  type AnyResultIndex,
} from "@carrick/gamebench-core";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  normalizePublication,
  normalizeResultEntry,
  type NormalizedAggregate,
  type NormalizedEvaluation,
  type NormalizedPublication,
  type NormalizedResultEntry,
  type NormalizedSubmission,
} from "./normalize.ts";

export const repositoryRoot = await findRepositoryRoot();
export const defaultOfficialSeed = 104729;
export const siteBuildId =
  process.env.GAMEBENCH_SITE_BUILD_ID ??
  process.env.GITHUB_SHA ??
  "local";

type SiteRelease = AnyReleaseLock | (LiteReleaseLock & {
  task_count: number;
  tracks: ["build"];
  protocols: Record<string, never>;
  official: {
    agent_invocations_per_task: 1;
    evaluation_seeds: [number];
  };
  tasks: Array<LiteReleaseLock["tasks"][number] & { track: "build" }>;
});

export interface PublicationRecord {
  entry: NormalizedResultEntry;
  publication: NormalizedPublication;
}

export interface ReleaseCatalog {
  release: SiteRelease;
  tasks: ReleasedTask[];
}

export interface PlayableCandidate {
  entry: NormalizedResultEntry;
  publication: NormalizedPublication;
  run: NormalizedEvaluation;
  playable: NormalizedEvaluation["artifacts"][number];
  showcase?: NormalizedEvaluation["artifacts"][number];
  source?: NormalizedEvaluation["artifacts"][number];
  license?: NormalizedEvaluation["artifacts"][number];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeLiteResult(input: unknown): PublicationRecord {
  const result = LiteSeriesResultSchema.parse(input);
  if (
    result.profile !== "official" ||
    !result.source_tree_clean ||
    result.git_commit === "unknown" ||
    result.build.completed !== 4 ||
    result.build.required !== 4 ||
    result.build.score === undefined
  ) {
    throw new Error(`non-Official lightweight result: ${result.series_id}`);
  }
  const publicationId = sha256Canonical(
    JSON.parse(JSON.stringify(result)) as JsonValue,
  );
  const configurationId = sha256Canonical(
    JSON.parse(JSON.stringify(result.configuration)) as JsonValue,
  );
  const evaluations: NormalizedEvaluation[] = result.tasks.map((task, index) => ({
    run_id: `${result.series_id}-evaluation-${index + 1}`,
    submission_id: `${result.series_id}-submission-${index + 1}`,
    input_fingerprint: task.source_hash,
    task_id: task.task_id,
    task_version: task.task_version,
    task_hash: task.task_hash,
    seed: task.evaluation.seed,
    included: task.evaluation.status === "scored",
    network_policy: "full",
    exit_reason: task.evaluation.status === "infrastructure-error"
      ? "evaluation-error"
      : task.agent.exit_reason === "agent-error"
        ? "agent-error"
        : task.agent.exit_reason === "timeout-delivery"
          ? "timeout"
          : "completed",
    development_exit_reason: task.agent.exit_reason === "agent-error"
      ? "agent-error"
      : task.agent.exit_reason === "timeout-delivery"
        ? "timeout"
        : "completed",
    ...(task.evaluation.score ? { score: task.evaluation.score } : {}),
    wall_time_ms: task.agent.wall_time_ms,
    artifacts: [],
    development_artifacts: [],
    evaluation_artifacts: [],
    agent_invocation_index: 1,
  }));
  const submissions: NormalizedSubmission[] = result.tasks.map((task, index) => ({
    submission_id: `${result.series_id}-submission-${index + 1}`,
    task_id: task.task_id,
    task_version: task.task_version,
    task_hash: task.task_hash,
    included: task.evaluation.status === "scored",
    agent_invocation_index: 1,
    development_exit_reason: evaluations[index]!.development_exit_reason,
    artifacts: [],
    evaluations: [evaluations[index]!],
  }));
  const aggregate: NormalizedAggregate = {
    schema_version: 3,
    primary_board: "build",
    tasks: result.tasks.map((task) => ({
      task_id: task.task_id,
      track: "build",
      submission_id: `${result.series_id}-submission-${result.tasks.indexOf(task) + 1}`,
      development_count: 1,
      evaluation_count: task.evaluation.status === "scored" ? 1 : 0,
      required_evaluation_count: 1,
      mean: task.evaluation.score?.percent ?? 0,
      standard_deviation: 0,
    })),
    coverage: {
      build: { completed: result.build.completed, required: result.build.required },
      reproduce: { completed: 0, required: 0 },
      core: { completed: 0, required: 0 },
    },
    evaluation_coverage: {
      build: { completed: result.build.completed, required: result.build.required },
      reproduce: { completed: 0, required: 0 },
      core: { completed: 0, required: 0 },
    },
    leaderboards: result.build.score === undefined ? {} : { build: result.build.score },
  };
  const configuration = {
    configuration_id: configurationId,
    agent: result.configuration.agent,
    prompt_language: result.configuration.prompt_language,
    execution_profile: "official-candidate" as const,
    environment: {
      platform: "linux",
      architecture: "unknown",
      node: "unknown",
      runner_protocol: "3" as const,
      git_commit: result.git_commit,
      source_tree_dirty: !result.source_tree_clean,
    },
  };
  const publication: NormalizedPublication = {
    schema_version: 2,
    publication_id: publicationId,
    created_at: result.finished_at,
    tier: "official",
    board: "build",
    series_id: result.series_id,
    benchmark: {
      version: result.benchmark_version,
      release_hash: result.release_hash,
      git_commit: result.git_commit,
    },
    configuration,
    aggregate,
    submissions,
    runs: evaluations,
    review_summaries: [],
  };
  const entry: NormalizedResultEntry = {
    publication_id: publicationId,
    created_at: result.finished_at,
    tier: "official",
    board: "build",
    status: "active",
    benchmark_version: result.benchmark_version,
    series_id: result.series_id,
    configuration_id: configurationId,
    agent: result.configuration.agent,
    aggregate,
  };
  return { entry, publication };
}

let releasesPromise: Promise<SiteRelease[]> | undefined;

async function loadReleases(): Promise<SiteRelease[]> {
  releasesPromise ??= (async () => {
    const releasesRoot = path.join(repositoryRoot, "benchmark", "releases");
    const files = (await readdir(releasesRoot))
      .filter((file) => file.endsWith(".json"));
    const releases = await Promise.all(
      files.map(async (file): Promise<SiteRelease> => {
        const input = await readJson(path.join(releasesRoot, file));
        const lite = LiteReleaseLockSchema.safeParse(input);
        if (lite.success) {
          return {
            ...lite.data,
            task_count: lite.data.tasks.length,
            tracks: ["build"],
            protocols: {},
            official: {
              agent_invocations_per_task: 1,
              evaluation_seeds: [lite.data.evaluation_seed],
            },
            tasks: lite.data.tasks.map((task) => ({ ...task, track: "build" as const })),
          };
        }
        return AnyReleaseLockSchema.parse(input);
      }),
    );
    return releases.sort((left, right) =>
      compareSemanticVersions(right.benchmark_version, left.benchmark_version),
    );
  })();
  return releasesPromise;
}

export async function releaseData(): Promise<SiteRelease[]> {
  return loadReleases();
}

let releaseCatalogPromise: Promise<ReleaseCatalog[]> | undefined;

export async function releaseCatalogData(): Promise<ReleaseCatalog[]> {
  releaseCatalogPromise ??= (async () => {
    const releases = await loadReleases();
    return Promise.all(
      releases.map(async (release) => ({
        release,
        tasks: await resolveReleasedTasks(release, repositoryRoot),
      })),
    );
  })();
  return releaseCatalogPromise;
}

export async function releaseCatalogFor(
  version: string,
): Promise<ReleaseCatalog | undefined> {
  const catalogs = await releaseCatalogData();
  return catalogs.find(
    (catalog) => catalog.release.benchmark_version === version,
  );
}

export async function resultData(): Promise<{
  index: AnyResultIndex;
  publications: NormalizedPublication[];
  records: PublicationRecord[];
}> {
  const resultsRoot = process.env.GAMEBENCH_RESULTS_ROOT
    ? path.resolve(process.env.GAMEBENCH_RESULTS_ROOT)
    : path.join(repositoryRoot, "results");
  const index = AnyResultIndexSchema.parse(
    await readJson(path.join(resultsRoot, "index.json")),
  );
  const releases = await loadReleases();
  const releaseByVersion = new Map(
    releases.map((release) => [release.benchmark_version, release]),
  );

  const legacyRecords = await Promise.all(
    index.entries.map(async (rawEntry) => {
      const rawPublication = AnyPublicationManifestSchema.parse(
        await readJson(
          path.join(
            resultsRoot,
            "publications",
            `${rawEntry.publication_id.slice("sha256:".length)}.json`,
          ),
        ),
      );
      const { publication_id: claimed, ...payload } = rawPublication;
      const actual = sha256Canonical(
        JSON.parse(JSON.stringify(payload)) as JsonValue,
      );
      if (actual !== claimed || claimed !== rawEntry.publication_id) {
        throw new Error(`invalid publication identity: ${rawEntry.publication_id}`);
      }
      const indexedPublicationSchema = "publication_schema_version" in rawEntry
        ? rawEntry.publication_schema_version
        : 1;
      const boardMismatch =
        "publication_schema_version" in rawEntry &&
        rawEntry.publication_schema_version === 2 &&
        rawPublication.schema_version === 2 &&
        rawEntry.board !== rawPublication.board;
      if (
        rawPublication.schema_version !== indexedPublicationSchema ||
        boardMismatch ||
        rawPublication.benchmark.version !== rawEntry.benchmark_version ||
        rawPublication.series_id !== rawEntry.series_id ||
        rawPublication.configuration.configuration_id !== rawEntry.configuration_id ||
        rawPublication.tier !== rawEntry.tier ||
        sha256Canonical(
          JSON.parse(JSON.stringify(rawPublication.aggregate)) as JsonValue,
        ) !==
          sha256Canonical(
            JSON.parse(JSON.stringify(rawEntry.aggregate)) as JsonValue,
          )
      ) {
        throw new Error(`publication index mismatch: ${rawEntry.publication_id}`);
      }
      const release = releaseByVersion.get(rawPublication.benchmark.version);
      if (!release) {
        throw new Error(
          `publication references unknown release ${rawPublication.benchmark.version}`,
        );
      }
      const lockPath = path.join(
        repositoryRoot,
        "benchmark",
        "releases",
        `${release.benchmark_version}.json`,
      );
      if (
        rawPublication.benchmark.release_hash !==
        `sha256:${await sha256File(lockPath)}`
      ) {
        throw new Error(`publication release mismatch: ${rawEntry.publication_id}`);
      }
      const releaseTasks = new Map(
        release.tasks.map((task) => [task.id, task]),
      );
      const publishedTasks = rawPublication.schema_version === 1
        ? rawPublication.runs
        : rawPublication.submissions;
      for (const publishedTask of publishedTasks) {
        const task = releaseTasks.get(publishedTask.task_id);
        if (
          !task ||
          task.hash !== publishedTask.task_hash ||
          task.version !== publishedTask.task_version
        ) {
          const identity = "run_id" in publishedTask
            ? publishedTask.run_id
            : publishedTask.submission_id;
          throw new Error(
            `publication result is outside release ${release.benchmark_version}: ${identity}`,
          );
        }
      }
      const publication = normalizePublication(rawPublication);
      const entry = normalizeResultEntry(rawEntry, publication);
      return { entry, publication };
    }),
  );

  const liteIndexPath = path.join(resultsRoot, "lite", "index.json");
  const liteIndex = LiteResultIndexSchema.parse(
    await exists(liteIndexPath)
      ? await readJson(liteIndexPath)
      : { schema_version: 1, results: [] },
  );
  const liteRecords = await Promise.all(liteIndex.results.map(async (item) => {
    const expectedPath = `results/lite/${item.benchmark_version}/${item.series_id}.json`;
    if (item.path !== expectedPath) {
      throw new Error(`unsafe lightweight result path: ${item.path}`);
    }
    const input = LiteSeriesResultSchema.parse(
      await readJson(path.join(resultsRoot, item.path.slice("results/".length))),
    );
    const release = releaseByVersion.get(item.benchmark_version);
    const lockPath = path.join(
      repositoryRoot,
      "benchmark",
      "releases",
      `${item.benchmark_version}.json`,
    );
    if (
      !release ||
      input.release_hash !== `sha256:${await sha256File(lockPath)}` ||
      input.tasks.some((row) => {
        const task = release.tasks.find((candidate) => candidate.id === row.task_id);
        return !task || task.version !== row.task_version || task.hash !== row.task_hash;
      })
    ) {
      throw new Error(`lightweight result is outside its release: ${item.series_id}`);
    }
    const record = normalizeLiteResult(input);
    if (
      record.entry.benchmark_version !== item.benchmark_version ||
      record.entry.series_id !== item.series_id
    ) {
      throw new Error(`lightweight result index mismatch: ${item.series_id}`);
    }
    return record;
  }));
  const records = [...legacyRecords, ...liteRecords];

  const byId = new Map(
    records.map((record) => [record.entry.publication_id, record.entry]),
  );
  for (const entry of index.entries) {
    if (entry.status === "superseded") {
      if (!entry.superseded_by || !byId.has(entry.superseded_by)) {
        throw new Error(
          `superseded result has no published replacement: ${entry.publication_id}`,
        );
      }
    } else if (entry.superseded_by) {
      throw new Error(
        `only superseded results may name superseded_by: ${entry.publication_id}`,
      );
    }
  }
  const indexedVersions = [...new Set(
    index.entries.map((entry) => entry.benchmark_version),
  )].sort((left, right) => compareSemanticVersions(right, left));
  if (JSON.stringify(indexedVersions) !== JSON.stringify(index.benchmark_versions)) {
    throw new Error("result index benchmark_versions is stale or unsorted");
  }

  return {
    index,
    publications: records.map((record) => record.publication),
    records,
  };
}

export async function gameData() {
  return listTasks(repositoryRoot);
}

function candidateOrder(
  left: PlayableCandidate,
  right: PlayableCandidate,
): number {
  const tier = Number(right.entry.tier === "official") -
    Number(left.entry.tier === "official");
  if (tier !== 0) {
    return tier;
  }
  const status = Number(right.entry.status === "active") -
    Number(left.entry.status === "active");
  if (status !== 0) {
    return status;
  }
  const seed =
    Number(left.run.seed !== defaultOfficialSeed) -
    Number(right.run.seed !== defaultOfficialSeed);
  if (seed !== 0) {
    return seed;
  }
  return (
    right.entry.created_at.localeCompare(left.entry.created_at) ||
    left.publication.publication_id.localeCompare(
      right.publication.publication_id,
    ) ||
    left.run.run_id.localeCompare(right.run.run_id)
  );
}

export function playableCandidatesForTask(
  taskId: string,
  version: string,
  records: PublicationRecord[],
): PlayableCandidate[] {
  const candidates: PlayableCandidate[] = [];
  for (const record of records) {
    if (record.publication.benchmark.version !== version) {
      continue;
    }
    for (const run of record.publication.runs) {
      const playable = run.artifacts.find(
        (artifact) => artifact.role === "playable",
      );
      if (!run.included || run.task_id !== taskId || !playable) {
        continue;
      }
      const showcaseName =
        `${taskId.replace(/[^a-zA-Z0-9._-]+/g, "-")}-showcase.png`;
      const showcase = run.artifacts.find(
        (artifact) =>
          artifact.role === "screenshot" &&
          artifact.file_name === showcaseName,
      );
      const source = run.artifacts.find(
        (artifact) => artifact.role === "clean-source",
      );
      const license = run.artifacts.find(
        (artifact) => artifact.role === "license",
      );
      candidates.push({
        ...record,
        run,
        playable,
        ...(showcase ? { showcase } : {}),
        ...(source ? { source } : {}),
        ...(license ? { license } : {}),
      });
    }
  }
  const ordered = candidates.sort(candidateOrder);
  const unique = new Map<string, PlayableCandidate>();
  for (const candidate of ordered) {
    const key = [
      candidate.entry.publication_id,
      candidate.run.submission_id,
      candidate.playable.artifact_id,
    ].join("\0");
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()];
}

export function defaultPlayableCandidate(
  candidates: PlayableCandidate[],
): PlayableCandidate | undefined {
  const officialDefault = candidates.find(
    (candidate) =>
      candidate.entry.tier === "official" &&
      candidate.entry.status === "active" &&
      candidate.run.seed === defaultOfficialSeed,
  );
  return officialDefault ?? candidates[0];
}

export function score(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(1);
}
