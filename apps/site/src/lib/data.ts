import {
  AnyPublicationManifestSchema,
  AnyResultIndexSchema,
  readReleaseLock,
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
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalFlatResults,
  flatCampaignPlans,
  qualifyIndexedFlatResults,
  siteReleaseContexts,
  siteResultsRoot,
} from "./flat-data.ts";
import { projectFlatBuildResult, type FlatBuildRecord } from "./build-data.ts";
import {
  normalizePublication,
  normalizeResultEntry,
  type NormalizedEvaluation,
  type NormalizedPublication,
  type NormalizedResultEntry,
} from "./normalize.ts";

export const repositoryRoot = await findRepositoryRoot();
export const defaultOfficialSeed = 104729;
export const siteBuildId =
  process.env.GAMEBENCH_SITE_BUILD_ID ??
  process.env.GITHUB_SHA ??
  "local";

export type SiteRelease = AnyReleaseLock | (Omit<LiteReleaseLock, "schema_version"> & {
  schema_version: 1 | 4;
  task_count: number;
  tracks: ["build"];
  protocols: Record<string, number>;
  official: {
    agent_invocations_per_task: 1;
    evaluation_seeds: [104729];
  };
  tasks: Array<LiteReleaseLock["tasks"][number] & { track: "build" }>;
});

/** Display only: V4's Build instrument is exactly v0.6, not legacy v0.5.
 * Never project Play tasks, Reproduce, or a three-seed matrix onto Build pages.
 */
export function projectBuildRelease(input: unknown): SiteRelease {
  const lock = readReleaseLock(input);
  if (lock.schema_version !== 4 && "tracks" in lock) return lock;
  const build = lock.schema_version === 4 ? lock.suites.build : lock;
  return {
    schema_version: lock.schema_version,
    benchmark: lock.benchmark,
    benchmark_version: lock.benchmark_version,
    evaluation_seed: build.evaluation_seed,
    agent_invocations_per_task: build.agent_invocations_per_task,
    scoring: build.scoring,
    task_count: build.tasks.length,
    tracks: ["build"],
    protocols: lock.schema_version === 4 ? lock.protocols : {},
    official: { agent_invocations_per_task: 1, evaluation_seeds: [build.evaluation_seed] },
    tasks: build.tasks.map((task) => ({ ...task, track: "build" as const })),
  };
}

/** Pre-flat publications alone use the immutable historical adapter. */
export interface PublicationRecord {
  entry: NormalizedResultEntry;
  publication: NormalizedPublication;
}

export type SiteResultRecord = PublicationRecord | FlatBuildRecord;

export function isPublicationRecord(record: SiteResultRecord): record is PublicationRecord {
  return "publication" in record;
}

export function isFlatBuildRecord(record: SiteResultRecord): record is FlatBuildRecord {
  return "result" in record;
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

let releasesPromise: Promise<SiteRelease[]> | undefined;

async function loadReleases(): Promise<SiteRelease[]> {
  releasesPromise ??= siteReleaseContexts(repositoryRoot).then((contexts) =>
    contexts.map(({ lock }) => projectBuildRelease(lock)),
  );
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

export async function resultData(options: { repositoryRoot?: string; resultsRoot?: string } = {}): Promise<{
  index: AnyResultIndex;
  publications: NormalizedPublication[];
  records: SiteResultRecord[];
}> {
  const root = options.repositoryRoot ?? repositoryRoot;
  const resultsRoot = options.resultsRoot ?? siteResultsRoot(root);
  const index = AnyResultIndexSchema.parse(
    await readJson(path.join(resultsRoot, "index.json")),
  );
  const releaseContexts = await siteReleaseContexts(root);
  const releases = releaseContexts.map(({ lock }) => projectBuildRelease(lock));
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
        root,
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

  const flatResults = await canonicalFlatResults(resultsRoot);
  const qualified = qualifyIndexedFlatResults(
    flatResults, releaseContexts, await flatCampaignPlans(root, flatResults),
  );
  const liteRecords = flatResults.flatMap((input) => {
    // The canonical ledger is mixed. Play is never fed to the Build normalizer.
    if (input.schema_version === 3 && input.suite === "play") return [];
    const release = releaseByVersion.get(input.benchmark_version);
    const context = releaseContexts.find(({ lock }) => lock.benchmark_version === input.benchmark_version);
    if (
      !release || input.release_hash !== context?.file_hash ||
      input.tasks.some((row) => {
        const task = release.tasks.find((candidate) => candidate.id === row.task_id);
        return !task || task.version !== row.task_version || task.hash !== row.task_hash;
      })
    ) {
      throw new Error(`lightweight result is outside its release: ${input.series_id}`);
    }
    const qualification = qualified.find(({ result }) =>
      result.series_id === input.series_id && result.benchmark_version === input.benchmark_version,
    );
    const record = projectFlatBuildResult(input, qualification);
    return record ? [record] : [];
  });
  const records: SiteResultRecord[] = [...legacyRecords, ...liteRecords];

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
    publications: legacyRecords.map((record) => record.publication),
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
  records: SiteResultRecord[],
): PlayableCandidate[] {
  const candidates: PlayableCandidate[] = [];
  for (const record of records) {
    if (!isPublicationRecord(record) || record.publication.benchmark.version !== version) {
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
