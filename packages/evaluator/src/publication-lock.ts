import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

export async function ensurePublicationDirectory(
  repositoryRoot: string,
  benchmarkVersion: string,
): Promise<string> {
  const resultsRoot = path.join(repositoryRoot, "results");
  const liteRoot = path.join(resultsRoot, "lite");
  for (const directory of [resultsRoot, liteRoot]) {
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`publication root component is not a real directory: ${directory}`);
    }
  }
  const versionRoot = path.join(liteRoot, benchmarkVersion);
  await mkdir(versionRoot, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") {
      throw error;
    }
  });
  const versionStats = await lstat(versionRoot);
  if (!versionStats.isDirectory() || versionStats.isSymbolicLink()) {
    throw new Error(`publication version root is not a real directory: ${versionRoot}`);
  }
  return versionRoot;
}

export async function acquirePublicationIndexLock(
  lockPath: string,
): Promise<() => Promise<void>> {
  const attempt = async (): Promise<boolean> => {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      return false;
    }
  };
  if (!(await attempt())) {
    const owner = Number((await readFile(lockPath, "utf8").catch(() => "")).trim());
    let alive = Number.isInteger(owner) && owner > 0;
    if (alive) {
      try {
        process.kill(owner, 0);
      } catch {
        alive = false;
      }
    }
    if (alive) {
      throw new Error(`publication index is locked by process ${owner}`);
    }
    await rm(lockPath, { force: true });
    if (!(await attempt())) {
      throw new Error("publication index lock could not be acquired");
    }
  }
  return async () => rm(lockPath, { force: true });
}
