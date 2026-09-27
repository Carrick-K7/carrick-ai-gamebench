import { randomBytes } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { LiteResultIndexSchema, type AnyFlatSeriesResult } from "@carrick/gamebench-core";
import { acquirePublicationIndexLock, ensurePublicationDirectory } from "./publication-lock.js";

/** Publish already-validated snapshots, irrespective of their result generation.
 * The index is the commit point. Indexed identities are immutable, including
 * missing indexed files. An interrupted writer's unindexed file is reusable
 * only when its bytes exactly match this validated snapshot; never replace it.
 */
export async function publishCheckedResults(
  repositoryRoot: string,
  results: readonly AnyFlatSeriesResult[],
): Promise<string[]> {
  if (results.length === 0) throw new Error("empty publication batch");
  // Capture before the first await: never copy a mutable raw result later.
  const snapshots = results.map((result) => ({
    entry: {
      benchmark_version: result.benchmark_version,
      series_id: result.series_id,
      path: `results/lite/${result.benchmark_version}/${result.series_id}.json`,
    },
    bytes: `${JSON.stringify(result, null, 2)}\n`,
  }));
  LiteResultIndexSchema.parse({ schema_version: 1, results: snapshots.map(({ entry }) => entry) });
  for (const { entry } of snapshots) await ensurePublicationDirectory(repositoryRoot, entry.benchmark_version);
  const indexPath = path.join(repositoryRoot, "results", "lite", "index.json");
  const releaseLock = await acquirePublicationIndexLock(`${indexPath}.lock`);
  const stagedIndex = `${indexPath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const created: string[] = [];
  let committed = false;
  const writeExclusive = async (file: string, bytes: string): Promise<void> => {
    const handle = await open(file, "wx");
    created.push(file); // Also remove a partial write on failure.
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
  };
  try {
    const indexStat = await lstat(indexPath);
    if (!indexStat.isFile() || indexStat.isSymbolicLink() || indexStat.nlink !== 1) throw new Error("canonical index must be a singly-linked regular file");
    const index = LiteResultIndexSchema.parse(JSON.parse(await readFile(indexPath, "utf8")));
    const identities = new Set(index.results.map((entry) => `${entry.benchmark_version}/${entry.series_id}`));
    for (const { entry } of snapshots) {
      if (identities.has(`${entry.benchmark_version}/${entry.series_id}`)) throw new Error("published result is already indexed; never replace or repair an immutable result");
    }
    // An indexed missing/link file is an integrity failure, not an orphan.
    for (const entry of index.results) {
      const stat = await lstat(path.join(repositoryRoot, entry.path));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("indexed result must be a singly-linked regular file");
    }
    const updated = LiteResultIndexSchema.parse({ ...index, results: [...index.results, ...snapshots.map(({ entry }) => entry)] });
    const destinations: string[] = [];
    for (const { entry, bytes } of snapshots) {
      const directory = await ensurePublicationDirectory(repositoryRoot, entry.benchmark_version);
      const destination = path.join(directory, `${entry.series_id}.json`);
      destinations.push(destination);
      let existing;
      try { existing = await lstat(destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error("unindexed result must be a singly-linked regular file");
        if (!Buffer.from(bytes).equals(await readFile(destination))) throw new Error("unindexed result differs from the validated snapshot; refusing to overwrite it");
      } else await writeExclusive(destination, bytes);
    }
    await writeExclusive(stagedIndex, `${JSON.stringify(updated, null, 2)}\n`);
    await rename(stagedIndex, indexPath);
    committed = true;
    return destinations;
  } finally {
    try {
      if (!committed) await Promise.all(created.map((file) => rm(file, { force: true })));
    } finally { await releaseLock(); }
  }
}
