import { readdir, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256File } from "@carrick/gamebench-core";
import { runCommand } from "./process.js";

type HashRef = `sha256:${string}`;

const EXCLUDED_TOP_LEVEL_ENTRIES = new Set([".git", "dist", "node_modules"]);

async function assertRegularWorkspaceTree(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    if (!relative.includes(path.sep) && EXCLUDED_TOP_LEVEL_ENTRIES.has(entry.name)) {
      continue;
    }
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`submission workspace contains a symbolic link: ${relative}`);
    }
    if (stat.isDirectory()) {
      await assertRegularWorkspaceTree(root, absolute);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`submission workspace contains a special file: ${relative}`);
    }
    if (stat.nlink > 1) {
      throw new Error(`submission workspace contains a hard-linked file: ${relative}`);
    }
  }
}

function assertSafeArchiveEntry(entry: string): void {
  const normalized = entry.replace(/^\.\//, "");
  if (normalized === "" || normalized === ".") {
    return;
  }
  if (
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`submission archive contains an unsafe path: ${entry}`);
  }
}

async function assertSafeArchive(
  archivePath: string,
  workingDirectory: string,
  logPath: string,
): Promise<void> {
  const listingPath = path.join(workingDirectory, "archive-entries.txt");
  const typeListingPath = path.join(workingDirectory, "archive-types.txt");
  const result = await runCommand(
    "tar",
    ["--zstd", "-tf", archivePath],
    {
      cwd: workingDirectory,
      stdoutPath: listingPath,
      stderrPath: logPath,
      append: true,
      timeoutMs: 120_000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`could not inspect submission archive; tar exited ${result.exitCode}`);
  }
  const typeResult = await runCommand(
    "tar",
    ["--zstd", "-tvf", archivePath],
    {
      cwd: workingDirectory,
      stdoutPath: typeListingPath,
      stderrPath: logPath,
      append: true,
      timeoutMs: 120_000,
    },
  );
  if (typeResult.exitCode !== 0) {
    throw new Error(`could not inspect submission archive types; tar exited ${typeResult.exitCode}`);
  }
  const { readFile } = await import("node:fs/promises");
  const entries = (await readFile(listingPath, "utf8")).split("\n");
  const typeEntries = (await readFile(typeListingPath, "utf8")).split("\n");
  await Promise.all([
    rm(listingPath, { force: true }),
    rm(typeListingPath, { force: true }),
  ]);
  for (const entry of typeEntries) {
    if (entry && entry[0] !== "-" && entry[0] !== "d") {
      throw new Error(`submission archive contains a link or special entry: ${entry}`);
    }
  }
  for (const entry of entries) {
    if (entry) {
      assertSafeArchiveEntry(entry);
    }
  }
}

export interface SealedSubmission {
  archivePath: string;
  sourceSnapshotHash: HashRef;
}

export async function sealSubmissionWorkspace(
  workspace: string,
  archivePath: string,
  logPath: string,
): Promise<SealedSubmission> {
  await assertRegularWorkspaceTree(workspace);
  await mkdir(path.dirname(archivePath), { recursive: true });
  const result = await runCommand(
    "tar",
    [
      "--zstd",
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "--pax-option=delete=atime,delete=ctime",
      "--exclude=./node_modules",
      "--exclude=./dist",
      "--exclude=./.git",
      "-cf",
      archivePath,
      "-C",
      workspace,
      ".",
    ],
    {
      cwd: workspace,
      stdoutPath: logPath,
      stderrPath: logPath,
      append: true,
      timeoutMs: 120_000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`could not archive submission workspace; tar exited ${result.exitCode}`);
  }
  return {
    archivePath,
    sourceSnapshotHash: `sha256:${await sha256File(archivePath)}`,
  };
}

export async function materializeSubmissionArchive(
  archivePath: string,
  expectedHash: HashRef,
  destination: string,
  logPath: string,
): Promise<void> {
  const actualHash = `sha256:${await sha256File(archivePath)}` as HashRef;
  if (actualHash !== expectedHash) {
    throw new Error(
      `submission archive hash mismatch: expected ${expectedHash}, received ${actualHash}`,
    );
  }
  await mkdir(destination, { recursive: true });
  await assertSafeArchive(archivePath, destination, logPath);
  const result = await runCommand(
    "tar",
    [
      "--zstd",
      "--extract",
      "--file",
      archivePath,
      "--directory",
      destination,
      "--no-same-owner",
      "--no-same-permissions",
    ],
    {
      cwd: destination,
      stdoutPath: logPath,
      stderrPath: logPath,
      append: true,
      timeoutMs: 120_000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`could not extract submission archive; tar exited ${result.exitCode}`);
  }
  await assertRegularWorkspaceTree(destination);
}

export async function withMaterializedSubmission<T>(
  archivePath: string,
  expectedHash: HashRef,
  logPath: string,
  operation: (workspace: string) => Promise<T>,
): Promise<T> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cagb-submission-"));
  const workspace = path.join(temporaryRoot, "workspace");
  try {
    await materializeSubmissionArchive(
      archivePath,
      expectedHash,
      workspace,
      logPath,
    );
    return await operation(workspace);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
