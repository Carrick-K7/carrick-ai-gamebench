import {
  PublicationManifestSchema,
  ReleaseLockSchema,
  ResultIndexSchema,
  compareSemanticVersions,
  findRepositoryRoot,
  listTasks,
  resolveReleasedTasks,
  sha256Canonical,
  sha256File,
  type JsonValue,
  type PublicationManifest,
  type ReleaseLock,
  type ReleasedTask,
  type ResultIndex,
} from "@carrick/gamebench-core";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = await findRepositoryRoot();
export const defaultOfficialSeed = 104729;
export const siteBuildId =
  process.env.GAMEBENCH_SITE_BUILD_ID ??
  process.env.GITHUB_SHA ??
  "local";

type ResultEntry = ResultIndex["entries"][number];

export interface PublicationRecord {
  entry: ResultEntry;
  publication: PublicationManifest;
}

export interface ReleaseCatalog {
  release: ReleaseLock;
  tasks: ReleasedTask[];
}

export interface PlayableCandidate {
  entry: ResultEntry;
  publication: PublicationManifest;
  run: PublicationManifest["runs"][number];
  playable: PublicationManifest["runs"][number]["artifacts"][number];
  showcase?: PublicationManifest["runs"][number]["artifacts"][number];
  source?: PublicationManifest["runs"][number]["artifacts"][number];
  license?: PublicationManifest["runs"][number]["artifacts"][number];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

let releasesPromise: Promise<ReleaseLock[]> | undefined;

async function loadReleases(): Promise<ReleaseLock[]> {
  releasesPromise ??= (async () => {
    const releasesRoot = path.join(repositoryRoot, "benchmark", "releases");
    const files = (await readdir(releasesRoot))
      .filter((file) => file.endsWith(".json"));
    const releases = await Promise.all(
      files.map(async (file) =>
        ReleaseLockSchema.parse(await readJson(path.join(releasesRoot, file))),
      ),
    );
    return releases.sort((left, right) =>
      compareSemanticVersions(right.benchmark_version, left.benchmark_version),
    );
  })();
  return releasesPromise;
}

export async function releaseData(): Promise<ReleaseLock[]> {
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
  index: ResultIndex;
  publications: PublicationManifest[];
  records: PublicationRecord[];
}> {
  const resultsRoot = process.env.GAMEBENCH_RESULTS_ROOT
    ? path.resolve(process.env.GAMEBENCH_RESULTS_ROOT)
    : path.join(repositoryRoot, "results");
  const index = ResultIndexSchema.parse(
    await readJson(path.join(resultsRoot, "index.json")),
  );
  const releases = await loadReleases();
  const releaseByVersion = new Map(
    releases.map((release) => [release.benchmark_version, release]),
  );

  const records = await Promise.all(
    index.entries.map(async (entry) => {
      const publication = PublicationManifestSchema.parse(
        await readJson(
          path.join(
            resultsRoot,
            "publications",
            `${entry.publication_id.slice("sha256:".length)}.json`,
          ),
        ),
      );
      const { publication_id: claimed, ...payload } = publication;
      const actual = sha256Canonical(
        JSON.parse(JSON.stringify(payload)) as JsonValue,
      );
      if (actual !== claimed || claimed !== entry.publication_id) {
        throw new Error(`invalid publication identity: ${entry.publication_id}`);
      }
      if (
        publication.benchmark.version !== entry.benchmark_version ||
        publication.series_id !== entry.series_id ||
        publication.configuration.configuration_id !== entry.configuration_id ||
        publication.tier !== entry.tier ||
        sha256Canonical(
          JSON.parse(JSON.stringify(publication.aggregate)) as JsonValue,
        ) !==
          sha256Canonical(
            JSON.parse(JSON.stringify(entry.aggregate)) as JsonValue,
          )
      ) {
        throw new Error(`publication index mismatch: ${entry.publication_id}`);
      }
      const release = releaseByVersion.get(publication.benchmark.version);
      if (!release) {
        throw new Error(
          `publication references unknown release ${publication.benchmark.version}`,
        );
      }
      const lockPath = path.join(
        repositoryRoot,
        "benchmark",
        "releases",
        `${release.benchmark_version}.json`,
      );
      if (
        publication.benchmark.release_hash !==
        `sha256:${await sha256File(lockPath)}`
      ) {
        throw new Error(`publication release mismatch: ${entry.publication_id}`);
      }
      const releaseTasks = new Map(
        release.tasks.map((task) => [task.id, task]),
      );
      for (const run of publication.runs) {
        const task = releaseTasks.get(run.task_id);
        if (
          !task ||
          task.hash !== run.task_hash ||
          task.version !== run.task_version
        ) {
          throw new Error(
            `publication run is outside release ${release.benchmark_version}: ${run.run_id}`,
          );
        }
      }
      return { entry, publication };
    }),
  );

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
  return candidates.sort(candidateOrder);
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
