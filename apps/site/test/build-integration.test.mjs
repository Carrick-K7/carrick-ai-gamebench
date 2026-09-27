import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readReleaseLock, sha256Canonical } from "@carrick/gamebench-core";
import { projectBuildRelease, releaseCatalogData, resultData } from "../src/lib/data.ts";
import { projectFlatBuildResult } from "../src/lib/build-data.ts";
import { qualifyIndexedFlatResults } from "../src/lib/flat-data.ts";
import { normalizePublication, normalizeResultEntry } from "../src/lib/normalize.ts";
import { assignCompetitionRanks, latestResultBearingVersion, rankingMetricForEntry } from "../src/lib/ranking.ts";
import { buildFixture, fixtureFiles, historicalLite, json, playFixture, repository } from "./build-play-fixtures.mjs";

test("V4 Build display is the exact v0.6 four-task single-104729-seed projection", async () => {
  const fixture = await playFixture();
  const old = await json("benchmark/releases/0.6.0.json");
  const projection = projectBuildRelease(fixture.release);
  assert.equal(projection.schema_version, 4);
  assert.equal(projection.task_count, 4);
  assert.deepEqual(projection.tracks, ["build"]);
  assert.deepEqual(projection.official, { agent_invocations_per_task: 1, evaluation_seeds: [104729] });
  assert.equal(projection.evaluation_seed, old.evaluation_seed);
  assert.deepEqual(projection.scoring, old.scoring);
  assert.deepEqual(projection.tasks, old.tasks.map((task) => ({ ...task, track: "build" })));
  assert.ok(projection.tasks.every((task) => task.id.startsWith("build.")));
  assert.ok(!("suites" in projection));
});

test("all pre-V4 historical releases and retained task URLs keep their exact identities", async () => {
  const files = (await readdir(path.join(repository, "benchmark/releases"))).filter((name) => name.endsWith(".json"));
  for (const file of files) {
    const raw = readReleaseLock(await json(`benchmark/releases/${file}`));
    if (raw.schema_version === 4) continue;
    const projected = projectBuildRelease(raw);
    if ("tracks" in raw) assert.deepEqual(projected, raw, file);
    else assert.deepEqual(projected.tasks.map(({ track, ...task }) => task), raw.tasks, file);
  }
  const catalogs = await releaseCatalogData();
  for (const version of ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0"]) {
    assert.ok(catalogs.some(({ release }) => release.benchmark_version === version), version);
  }
  const newest = catalogs.find(({ release }) => release.schema_version === 4);
  if (newest) assert.ok(newest.tasks.every((task) => task.source && task.track === "build"));
});

function assertDirectFlatView(record, original) {
  assert.deepEqual(Object.keys(record).sort(), ["entry", "result"]);
  assert.deepEqual(record.result, original, "original task provenance survives without reinterpretation");
  assert.equal(record.entry.publication_id, sha256Canonical(original));
  assert.equal(record.entry.configuration_id, sha256Canonical(original.configuration));
  assert.deepEqual(record.entry.build, original.build);
  for (const key of ["aggregate", "publication", "submissions", "runs", "environment", "evaluation_coverage", "reproduce", "core"]) {
    assert.ok(!(key in record) && !(key in record.entry), `no synthetic ${key}`);
  }
  assert.ok(!JSON.stringify(record).includes("submission_id"));
  assert.ok(!JSON.stringify(record).includes("runner_protocol"));
  assert.ok(!JSON.stringify(record).includes("standard_deviation"));
}

test("Build V3 projects directly without Lite conversion or invented legacy entities", async () => {
  const fixture = await playFixture();
  const build = await buildFixture(fixture);
  const qualified = qualifyIndexedFlatResults([build], [fixture.context], [])[0];
  const record = projectFlatBuildResult(build, qualified);
  assertDirectFlatView(record, build);
  assert.equal(record.result.schema_version, 3);
  assert.equal(record.entry.tier, "experimental", "self-declared official profile is not a qualification");
  assert.equal(record.entry.rankable, true);
  assert.equal(rankingMetricForEntry(record.entry), build.build.score);
  assert.equal(projectFlatBuildResult(fixture.results[0]), undefined, "Play never enters the Build projection");
  assert.throws(() => projectFlatBuildResult(build), /qualification/);
  const changed = structuredClone(build);
  changed.configuration.agent.model = "other";
  assert.throws(() => projectFlatBuildResult(changed, qualified), /qualification/);
  const source = await readFile(new URL("../src/lib/build-data.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /flatBuildV3ToLite|normalizeLiteResult|NormalizedPublication/);
});

test("incomplete flat tasks stay absent while real zero and failure provenance survive", async () => {
  const fixture = await playFixture();
  const build = await buildFixture(fixture);
  const task = build.tasks[0];
  task.evaluation = { seed: 104729, status: "infrastructure-error", message: "fixture browser unavailable" };
  build.build = { completed: 3, required: 4 };
  const qualified = qualifyIndexedFlatResults([build], [fixture.context], [])[0];
  const record = projectFlatBuildResult(build, qualified);
  assertDirectFlatView(record, build);
  assert.equal(record.entry.rankable, false);
  assert.equal(rankingMetricForEntry(record.entry), undefined);
  assert.equal(record.result.tasks[0].evaluation.score, undefined);
  assert.equal(record.result.tasks[0].evaluation.message, "fixture browser unavailable");
  assert.equal(rankingMetricForEntry({ build: { score: 0 } }), 0);
  assert.deepEqual(assignCompetitionRanks([rankingMetricForEntry(record.entry), 0]), [undefined, 1]);
});

test("mixed canonical Lite V2 / Build V3 / Play V3 index keeps direct Build records only", async (t) => {
  const fixture = await playFixture();
  const lite = await historicalLite();
  const build = await buildFixture(fixture);
  const files = await fixtureFiles(t, fixture, [lite, build, ...fixture.results]);
  await files.save("results/index.json", { schema_version: 1, generated_at: "2026-09-01T00:00:00.000Z", benchmark_versions: [], entries: [] });
  const { records, publications } = await resultData(files.options);
  assert.deepEqual(records.map(({ entry }) => entry.series_id), [lite.series_id, build.series_id]);
  assertDirectFlatView(records[0], lite);
  assertDirectFlatView(records[1], build);
  assert.deepEqual(publications, [], "flat results do not masquerade as legacy publications");
  assert.equal(records[0].entry.tier, "official", "v0.6 historical qualification is not rewritten");
  assert.equal(records[1].entry.tier, "experimental");
  assert.equal(records[1].entry.build.required, 4);
  assert.ok(records[1].result.tasks.every((task) => task.evaluation.seed === 104729));
});

test("real v0.6 public results retain seven rows, IDs, scores, and exact competition ranks", async () => {
  const { records } = await resultData({ resultsRoot: path.join(repository, "results") });
  const index = await json("results/lite/index.json");
  const originals = await Promise.all(index.results.filter((row) => row.benchmark_version === "0.6.0").map((row) => json(row.path)));
  const historic = records.filter(({ entry }) => entry.benchmark_version === "0.6.0");
  assert.equal(historic.length, 7);
  for (const raw of originals) {
    const record = historic.find(({ entry }) => entry.series_id === raw.series_id);
    assertDirectFlatView(record, raw);
    assert.equal(record.entry.tier, "official");
    assert.equal(record.entry.status, "active");
    assert.equal(record.entry.rankable, undefined, "no new ranking gate is applied retroactively");
  }
  const expected = originals.map((row) => row.build.score).sort((a, b) => b - a);
  const actual = historic.map(({ entry }) => rankingMetricForEntry(entry)).sort((a, b) => b - a);
  assert.deepEqual(assignCompetitionRanks(actual), assignCompetitionRanks(expected));
  assert.deepEqual(actual, expected);
  const releases = (await releaseCatalogData()).map(({ release }) => release);
  assert.equal(latestResultBearingVersion(releases, records), "0.6.0");
});

test("pre-flat publication adapters, artifact identities and ranking semantics are unchanged", async () => {
  const index = await json("results/index.json");
  const { records, publications } = await resultData({ resultsRoot: path.join(repository, "results") });
  assert.equal(publications.length, index.entries.length);
  for (const entry of index.entries) {
    const raw = await json(`results/publications/${entry.publication_id.slice(7)}.json`);
    const publication = normalizePublication(raw);
    const record = records.find((candidate) => candidate.entry.publication_id === entry.publication_id);
    assert.deepEqual(record, { entry: normalizeResultEntry(entry, publication), publication });
    assert.ok(!("result" in record));
  }
});

test("new instrument pages do not invent v0.5 Reproduce/three-seed semantics or a source tag", async () => {
  const source = await readFile(new URL("../src/pages/releases/[version].astro", import.meta.url), "utf8");
  assert.match(source, /release\.schema_version !== 4 && <a/);
  assert.match(source, /Build-only display/);
  assert.match(source, /source lock does not establish a published tag/);
  const rankings = await readFile(new URL("../src/components/RankingsPage.astro", import.meta.url), "utf8");
  assert.match(rankings, /const hasReproduceReport = buildPrimary && !lightweight/);
});
