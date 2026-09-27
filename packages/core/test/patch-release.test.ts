import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  LiteReleaseLockSchema,
  ReleaseLockV4Schema,
  createReleaseLockV4,
  loadPlayTasks,
  findRepositoryRoot,
  listTasks,
} from "../src/index.js";

async function readJson(root: string, relative: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

test("0.6.1 preserves the complete 0.6.0 scoring instrument", async () => {
  const root = await findRepositoryRoot();
  const previous = LiteReleaseLockSchema.parse(await readJson(root, "benchmark/releases/0.6.0.json"));
  const patch = LiteReleaseLockSchema.parse(await readJson(root, "benchmark/releases/0.6.1.json"));
  assert.equal(previous.benchmark_version, "0.6.0");
  assert.equal(patch.benchmark_version, "0.6.1");
  assert.deepEqual({ ...patch, benchmark_version: previous.benchmark_version }, previous);
});

test("workspace packages and the active release have one version and exact catalog", async () => {
  const root = await findRepositoryRoot();
  for (const relative of [
    "package.json",
    "packages/core/package.json",
    "packages/evaluator/package.json",
    "apps/site/package.json",
    "apps/reviewer/package.json",
  ]) {
    const manifest = await readJson(root, relative) as { version: string };
    assert.equal(manifest.version, "0.7.0", relative);
  }
  const release = ReleaseLockV4Schema.parse(await readJson(root, "benchmark/releases/0.7.0.json"));
  assert.deepEqual(release, createReleaseLockV4("0.7.0", await listTasks(root), await loadPlayTasks(root)));
  const previous = LiteReleaseLockSchema.parse(await readJson(root, "benchmark/releases/0.6.1.json"));
  assert.deepEqual(release.suites.build.tasks, previous.tasks);
  assert.equal(release.suites.build.evaluation_seed, previous.evaluation_seed);
});
