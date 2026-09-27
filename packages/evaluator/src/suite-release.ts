import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ReleaseLockV4Schema, SemverSchema, createReleaseLockV4, listTasks,
  loadPlayTasks, readReleaseLock, type ReleaseLockV4,
} from "@carrick/gamebench-core";
import { playEqual } from "./play/slot-audit.js";

export const BUILD_PLAY_BENCHMARK_VERSION = "0.7.0";

export async function activeBenchmarkVersion(repositoryRoot: string): Promise<string> {
  return SemverSchema.parse(JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).version);
}

export async function loadVersionedRelease(repositoryRoot: string, version?: string) {
  const requested = SemverSchema.parse(version ?? await activeBenchmarkVersion(repositoryRoot));
  const releasePath = path.join(repositoryRoot, "benchmark", "releases", `${requested}.json`);
  const stat = await lstat(releasePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("release lock must be a regular file");
  const bytes = await readFile(releasePath);
  const release = readReleaseLock(JSON.parse(bytes.toString("utf8")));
  if (release.benchmark_version !== requested) throw new Error("release filename and declared version differ");
  return { release, releasePath, releaseHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const };
}

export async function loadSuiteRelease(repositoryRoot: string, version?: string) {
  const loaded = await loadVersionedRelease(repositoryRoot, version);
  return { ...loaded, release: ReleaseLockV4Schema.parse(loaded.release) };
}

export async function assertSuiteCatalog(repositoryRoot: string, release: ReleaseLockV4): Promise<void> {
  const expected = createReleaseLockV4(release.benchmark_version, await listTasks(repositoryRoot), await loadPlayTasks(repositoryRoot));
  if (!playEqual(release, expected)) throw new Error("dual-suite release does not match the frozen Build/Play catalogs");
}

export function gitState(repositoryRoot: string): { commit: string; clean: boolean } {
  const read = (args: string[]) => {
    const answer = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return answer.status === 0 ? answer.stdout.trim() : undefined;
  };
  return { commit: read(["rev-parse", "HEAD"]) ?? "unknown", clean: read(["status", "--porcelain"]) === "" };
}

export function requireOfficialSource(repositoryRoot: string, expectedCommit?: string): ReturnType<typeof gitState> {
  const state = gitState(repositoryRoot);
  if (!state.clean || !/^[a-f0-9]{40}$/.test(state.commit) || (expectedCommit !== undefined && state.commit !== expectedCommit)) throw new Error("Official execution requires one unchanged clean Git commit");
  return state;
}
