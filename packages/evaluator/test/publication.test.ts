import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findRepositoryRoot, flatBuildV3FromLite, LiteSeriesResultSchema, writeJson, type AnyFlatSeriesResult } from "@carrick/gamebench-core";
import { publishCheckedResults } from "../src/publication.js";

const bytes = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const destination = (root: string, result: AnyFlatSeriesResult) => path.join(root, "results", "lite", result.benchmark_version, `${result.series_id}.json`);
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cagb-publication-"));
  const source = path.join(await findRepositoryRoot(), "results", "lite", "0.6.0", "01M197VGHHP8SYRDM8JWM5WV2K.json");
  const legacy = LiteSeriesResultSchema.parse(JSON.parse(await readFile(source, "utf8")));
  const results: AnyFlatSeriesResult[] = [legacy, flatBuildV3FromLite(legacy), flatBuildV3FromLite(legacy)];
  results.forEach((result, index) => { result.series_id = `01K0000000000000000000000${index}`; });
  const indexPath = path.join(root, "results", "lite", "index.json");
  await writeJson(indexPath, { schema_version: 1, results: [] });
  await mkdir(path.dirname(destination(root, legacy)));
  return { root, indexPath, results };
}

test("one writer publishes v2/v3 checked snapshots without rereading mutable raw records", async () => {
  const f = await fixture();
  try {
    const expected = f.results.map(bytes);
    const pending = publishCheckedResults(f.root, f.results);
    f.results[0]!.configuration.agent.model = "changed-after-validation";
    const files = await pending;
    assert.deepEqual(files, f.results.map((result) => destination(f.root, result)));
    assert.deepEqual(await Promise.all(files.map((file) => readFile(file, "utf8"))), expected);
    assert.equal(JSON.parse(await readFile(f.indexPath, "utf8")).results.length, 3);
    await assert.rejects(publishCheckedResults(f.root, [f.results[1]!]), /already indexed/);
    assert.equal(await readFile(files[1]!, "utf8"), expected[1]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("only byte-identical unindexed orphans can be recovered; rollback preserves prior files", async () => {
  const f = await fixture();
  try {
    const [same, created, conflict] = f.results;
    const sameFile = destination(f.root, same!);
    const newFile = destination(f.root, created!);
    const conflictFile = destination(f.root, conflict!);
    await writeFile(sameFile, bytes(same));
    await writeFile(conflictFile, "different orphan bytes\n");
    const before = await readFile(f.indexPath, "utf8");
    await assert.rejects(publishCheckedResults(f.root, f.results), /unindexed result differs/);
    assert.equal(await readFile(f.indexPath, "utf8"), before);
    assert.equal(await readFile(sameFile, "utf8"), bytes(same));
    assert.equal(await readFile(conflictFile, "utf8"), "different orphan bytes\n");
    await assert.rejects(readFile(newFile), { code: "ENOENT" });
    assert.deepEqual((await readdir(path.dirname(f.indexPath))).sort(), ["0.6.0", "index.json"]);
    await rm(conflictFile);
    assert.equal((await publishCheckedResults(f.root, f.results)).length, 3);
    assert.equal(await readFile(sameFile, "utf8"), bytes(same));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("missing indexed results are integrity failures and never repaired", async () => {
  const f = await fixture();
  try {
    const result = f.results[0]!;
    await publishCheckedResults(f.root, [result]);
    await rm(destination(f.root, result));
    const before = await readFile(f.indexPath, "utf8");
    await assert.rejects(publishCheckedResults(f.root, [result]), /already indexed/);
    await assert.rejects(publishCheckedResults(f.root, [f.results[1]!]), { code: "ENOENT" });
    assert.equal(await readFile(f.indexPath, "utf8"), before);
    await assert.rejects(readFile(destination(f.root, result)), { code: "ENOENT" });
    await assert.rejects(readFile(destination(f.root, f.results[1]!)), { code: "ENOENT" });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const kind of ["symlink", "hardlink"] as const) {
  test(`publication rejects ${kind} orphans without touching their targets`, async () => {
    const f = await fixture();
    try {
      const result = f.results[0]!;
      const outside = path.join(f.root, "outside.json");
      await writeFile(outside, bytes(result));
      if (kind === "symlink") await symlink(outside, destination(f.root, result));
      else await link(outside, destination(f.root, result));
      await assert.rejects(publishCheckedResults(f.root, [result]), /singly-linked regular file/);
      assert.equal(await readFile(outside, "utf8"), bytes(result));
      assert.equal(JSON.parse(await readFile(f.indexPath, "utf8")).results.length, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
}

test("concurrent writers serialize index updates without losing a committed row", async () => {
  const f = await fixture();
  try {
    const results = f.results.slice(0, 2);
    const attempts = await Promise.allSettled(results.map((result) => publishCheckedResults(f.root, [result])));
    assert.ok(attempts.some((attempt) => attempt.status === "fulfilled"));
    for (const [index, attempt] of attempts.entries()) if (attempt.status === "rejected") {
      assert.match(String(attempt.reason), /locked|could not be acquired/);
      await publishCheckedResults(f.root, [results[index]!]);
    }
    const indexed = JSON.parse(await readFile(f.indexPath, "utf8")).results;
    assert.deepEqual(indexed.map((row: { series_id: string }) => row.series_id).sort(), results.map((result) => result.series_id).sort());
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
