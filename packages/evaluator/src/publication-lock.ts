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
      try { await handle.writeFile(`${process.pid}\n`); }
      finally { await handle.close(); }
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
    // A writer may have created the file but not written its PID yet. Unknown
    // ownership is not a stale lock: fail closed and let an operator inspect it.
    if (!Number.isSafeInteger(owner) || owner <= 0) {
      throw new Error("publication index is locked with an unconfirmed owner; inspect the lock before removing it");
    }
    let alive = true;
    try {
      process.kill(owner, 0);
    } catch (error) {
      // EPERM (or any unrecognized failure) does not prove the owner is dead.
      alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (alive) {
      throw new Error(`publication index is locked by process ${owner}`);
    }
    // Even an ESRCH owner is not safe to reclaim automatically: two contenders
    // could both observe the old PID and one unlink the other's fresh lock.
    throw new Error(`publication index is locked by stale process ${owner}; confirm no publisher is running before removing the lock`);
  }
  return async () => rm(lockPath, { force: true });
}
