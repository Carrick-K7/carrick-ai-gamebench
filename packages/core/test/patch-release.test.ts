import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  LITE_BENCHMARK_VERSION,
  LiteReleaseLockSchema,
  createLiteReleaseLock,
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
    assert.equal(manifest.version, LITE_BENCHMARK_VERSION, relative);
  }
  const release = LiteReleaseLockSchema.parse(await readJson(
    root, `benchmark/releases/${LITE_BENCHMARK_VERSION}.json`,
  ));
  assert.deepEqual(release, createLiteReleaseLock(LITE_BENCHMARK_VERSION, await listTasks(root)));
});
