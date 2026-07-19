import {
  PublicationManifestSchema,
  ReleaseLockSchema,
  ResultIndexSchema,
  findRepositoryRoot,
  listTasks,
  sha256Canonical,
  type JsonValue,
  type PublicationManifest,
  type ResultIndex,
} from "@carrick/gamebench-core";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = await findRepositoryRoot();

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function resultData(): Promise<{
  index: ResultIndex;
  publications: PublicationManifest[];
}> {
  const resultsRoot = process.env.GAMEBENCH_RESULTS_ROOT
    ? path.resolve(process.env.GAMEBENCH_RESULTS_ROOT)
    : path.join(repositoryRoot, "results");
  const index = ResultIndexSchema.parse(
    await readJson(path.join(resultsRoot, "index.json")),
  );
  const publications = await Promise.all(
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
        publication.configuration.configuration_id !== entry.configuration_id
      ) {
        throw new Error(`publication index mismatch: ${entry.publication_id}`);
      }
      return publication;
    }),
  );
  return { index, publications };
}

export async function gameData() {
  return listTasks(repositoryRoot);
}

export async function releaseData() {
  const releasesRoot = path.join(repositoryRoot, "benchmark", "releases");
  const files = (await readdir(releasesRoot))
    .filter((file) => file.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left));
  return Promise.all(
    files.map(async (file) =>
      ReleaseLockSchema.parse(await readJson(path.join(releasesRoot, file))),
    ),
  );
}

export function playableForTask(
  taskId: string,
  publications: PublicationManifest[],
) {
  for (const publication of publications) {
    const run = publication.runs.find(
      (candidate) =>
        candidate.included &&
        candidate.task_id === taskId &&
        candidate.artifacts.some((artifact) => artifact.role === "playable"),
    );
    const playable = run?.artifacts.find(
      (artifact) => artifact.role === "playable",
    );
    if (run && playable) {
      return { publication, run, playable };
    }
  }
  return undefined;
}

export function score(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(1);
}
