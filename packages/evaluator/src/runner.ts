import { copyFile, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  resolveTaskPath,
  type LoadedTask,
} from "@carrick/gamebench-core";

function resolveStarter(repositoryRoot: string, task: LoadedTask): string {
  return path.join(
    repositoryRoot,
    "benchmark",
    "starters",
    task.manifest.starter,
  );
}

async function copyWorkspace(source: string, destination: string): Promise<void> {
  const ignored = new Set(["node_modules", "dist", ".git"]);
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    filter: (entry) => !ignored.has(path.basename(entry)),
  });
}

export async function prepareSubmissionWorkspace(
  repositoryRoot: string,
  task: LoadedTask,
  workspace: string,
): Promise<string> {
  await copyWorkspace(resolveStarter(repositoryRoot, task), workspace);
  const schemaRelative = task.manifest.bridge.state_schema;
  const schemaDestination = path.resolve(workspace, schemaRelative);
  const workspaceRoot = path.resolve(workspace);
  if (!schemaDestination.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`state schema escapes submission workspace: ${schemaRelative}`);
  }
  await mkdir(path.dirname(schemaDestination), { recursive: true });
  await copyFile(resolveTaskPath(task.root, schemaRelative), schemaDestination);
  const publicTaskDir = path.join(workspace, "gamebench");
  await mkdir(publicTaskDir, { recursive: true });
  await Promise.all([
    copyFile(
      resolveTaskPath(task.root, task.manifest.test_suite),
      path.join(publicTaskDir, "public-tests.json"),
    ),
    copyFile(
      path.resolve(task.root, "task.yml"),
      path.join(publicTaskDir, "task.yml"),
    ),
  ]);
  return schemaDestination;
}
