import { createHash } from "node:crypto";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { formatZodIssues } from "./schema.js";
import {
  PlayTaskManifestSchema,
  type PlayTaskManifest,
} from "./play-schema.js";
import { findRepositoryRoot } from "./tasks.js";

/**
 * Play task loading is deliberately separate from the legacy recursive Build
 * task loader. Reference tasks live under benchmark/play/<game>/v1/ and are
 * dependency-free, versioned ESM packages whose engine, renderer, resources,
 * prompt and manifest are hashed together as the immutable game package.
 */

export interface LoadedPlayTask {
  root: string;
  manifestPath: string;
  manifest: PlayTaskManifest;
  /** SHA-256 over every file in the task package (the game hash). */
  hash: string;
  files: string[];
}

export interface PlayValidationResult {
  valid: boolean;
  errors: string[];
  task?: LoadedPlayTask;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveWithin(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relative);
  if (!absolute.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Play task file escapes its root: ${relative}`);
  }
  return absolute;
}

async function listPlayTaskFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isSymbolicLink()) {
        throw new Error(`symlink is not allowed in a play task: ${relative}`);
      }
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          throw new Error(`Play game packages must be self-contained: ${relative}`);
        }
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`special entry is not allowed in a play task: ${relative}`);
      }
      const fileStat = await stat(absolute);
      if (fileStat.nlink > 1) {
        throw new Error(`hardlinked file is not allowed in a play task: ${relative}`);
      }
      files.push(relative.split(path.sep).join("/"));
    }
  }
  await walk(root);
  return files.sort();
}

async function hashPlayFiles(
  root: string,
  relativePaths: string[],
): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of [...new Set(relativePaths)].sort()) {
    const normalized = relative.split(path.sep).join("/");
    const absolute = resolveWithin(root, relative);
    const fileStat = await stat(absolute);
    if (!fileStat.isFile()) {
      throw new Error(`Play task input is not a file: ${relative}`);
    }
    hash.update(normalized);
    hash.update("\0");
    hash.update(await readFile(absolute));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function walkForPlayTaskManifests(
  directory: string,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkForPlayTaskManifests(absolute);
      }
      return entry.isFile() && entry.name === "task.yml" ? [absolute] : [];
    }),
  );
  return paths.flat().sort();
}

/**
 * Validate one Play task manifest, its directory layout, required files and
 * the immutable game-package hash.
 */
export async function validatePlayTask(
  manifestPath: string,
): Promise<PlayValidationResult> {
  const root = path.dirname(manifestPath);
  const errors: string[] = [];
  let raw: unknown;

  try {
    raw = parseYaml(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      valid: false,
      errors: [
        `Cannot parse ${manifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const parsed = PlayTaskManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, errors: formatZodIssues(parsed.error) };
  }
  const manifest = parsed.data;

  const idMajor = Number(manifest.id.match(/\.v(\d+)$/)?.[1]);
  const idSuffix = `.v${idMajor}`;
  const gameSlug = manifest.id.slice("play.".length, -idSuffix.length);
  if (manifest.game !== gameSlug) {
    errors.push(`id game slug ${gameSlug} does not match manifest game ${manifest.game}`);
  }
  if (path.basename(root) !== `v${idMajor}`) {
    errors.push(`play task directory must end in v${idMajor}`);
  }
  if (path.basename(path.dirname(root)) !== gameSlug) {
    errors.push(`play task parent directory must match game slug ${gameSlug}`);
  }
  if (path.basename(path.dirname(path.dirname(root))) !== "play") {
    errors.push("play task must live under benchmark/play/<game>/v1");
  }

  const requiredFiles = [
    manifest.engine,
    manifest.renderer,
    manifest.prompt.en,
    manifest.prompt.zh,
    "LICENSE",
  ];
  for (const relative of requiredFiles) {
    let absolute: string;
    try {
      absolute = resolveWithin(root, relative);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (!(await exists(absolute))) {
      errors.push(`missing play task file: ${relative}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  try {
    const files = await listPlayTaskFiles(root);
    const hash = await hashPlayFiles(root, files);
    return {
      valid: true,
      errors: [],
      task: { root, manifestPath, manifest, hash, files },
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
}

async function loadPlayTaskCatalog(
  playRoot: string,
  repositoryRoot: string,
): Promise<LoadedPlayTask[]> {
  if (!(await exists(playRoot))) {
    return [];
  }
  const manifests = await walkForPlayTaskManifests(playRoot);
  const tasks: LoadedPlayTask[] = [];
  const failures: string[] = [];
  for (const manifestPath of manifests) {
    const result = await validatePlayTask(manifestPath);
    if (!result.valid || !result.task) {
      failures.push(
        `${path.relative(repositoryRoot, manifestPath)}:\n  ${result.errors.join("\n  ")}`,
      );
    } else {
      tasks.push(result.task);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Invalid Play tasks:\n${failures.join("\n")}`);
  }
  return tasks.sort((left, right) =>
    left.manifest.id.localeCompare(right.manifest.id),
  );
}

export async function loadPlayTasks(
  repositoryRoot?: string,
): Promise<LoadedPlayTask[]> {
  const root = repositoryRoot ?? (await findRepositoryRoot());
  return loadPlayTaskCatalog(path.join(root, "benchmark", "play"), root);
}

export async function loadPlayTask(
  id: string,
  repositoryRoot?: string,
): Promise<LoadedPlayTask> {
  const tasks = await loadPlayTasks(repositoryRoot);
  const task = tasks.find((candidate) => candidate.manifest.id === id);
  if (!task) {
    throw new Error(`Unknown play task: ${id}`);
  }
  return task;
}
