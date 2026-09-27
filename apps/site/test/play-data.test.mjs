import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { playTrajectoryHash, sha256Canonical } from "@carrick/gamebench-core";
import {
  buildPlayGameRanking, formatPlayMetric, latestPlayResultBearingVersion,
  playGamePrimaryMetric, playResults, playVersionSelect, projectPlayReleases,
} from "../src/lib/play-data.ts";
import { canonicalFlatResults, qualifyIndexedFlatResults, siteReleaseContexts } from "../src/lib/flat-data.ts";
import { buildFixture, fixtureFiles, historicalLite, partialGame, playFixture, seriesId } from "./build-play-fixtures.mjs";

const qualify = (fixture, results = fixture.results) =>
  qualifyIndexedFlatResults(results, [fixture.context], [fixture.plan]);

test("shared qualification supplies real Official / Experimental sections, not profile proxies", async () => {
  const fixture = await playFixture();
  const results = structuredClone(fixture.results);
  results[1].profile = "local";
  const qualified = qualify(fixture, results);
  const official = buildPlayGameRanking("2048", "0.7.0", qualified, "official");
  const experimental = buildPlayGameRanking("2048", "0.7.0", qualified, "experimental");
  assert.equal(official.rows.length, 1);
  assert.equal(experimental.rows.length, 1);
  assert.deepEqual(official.ranks, [1]);
  assert.deepEqual(experimental.ranks, [1], "tiers do not compete");
  assert.equal(official.rows[0].tier, "official");
  assert.ok(!("eligible" in official.rows[0]));
  delete results[0].campaign;
  const unbound = qualify(fixture, [results[0]]);
  assert.equal(unbound[0].qualification.tier, "experimental", "official profile alone does not qualify");
  assert.ok(unbound[0].qualification.reasons.includes("no preregistered campaign binding"));
});

test("exact competition ties, real zero, and unknown values remain distinct", async () => {
  const fixture = await playFixture({ scores: [100.04, 100.04, 100.03, 0] });
  const results = fixture.results.map((result) => { const copy = structuredClone(result); delete copy.campaign; return copy; });
  const unknown = partialGame(results[0], "2048");
  unknown.series_id = seriesId(123);
  const rows = qualify(fixture, [...results, unknown]);
  const ranking = buildPlayGameRanking("2048", "0.7.0", rows, "experimental");
  assert.deepEqual(ranking.ranks, [1, 1, 3, 4, undefined]);
  assert.equal(ranking.rows[3].metric, 0);
  assert.equal(ranking.rows[4].metric, undefined);
  assert.equal(formatPlayMetric("2048", ranking.rows[0].metric), formatPlayMetric("2048", ranking.rows[2].metric), "display rounding cannot make a rank tie");
  assert.equal(formatPlayMetric("2048", undefined), "—");
  assert.equal(formatPlayMetric("2048", 0), "0");
  assert.equal(formatPlayMetric("minesweeper", 0), "0%");
});

test("partial whole series never ranks a surviving game's complete metric", async () => {
  const fixture = await playFixture({ scores: [90] });
  for (const partial of [partialGame(fixture.results[0]), { ...fixture.results[0], games: [fixture.results[0].games[0]] }]) {
    const qualified = qualify(fixture, [partial]);
    const ranking = buildPlayGameRanking("2048", "0.7.0", qualified, "experimental");
    assert.equal(ranking.rows[0].metric, 90, "retains raw observation");
    assert.equal(ranking.rows[0].incomplete, true);
    assert.equal(ranking.rows[0].rankable, false);
    assert.deepEqual(ranking.ranks, [undefined]);
  }
});

test("a Campaign must have ALL cells indexed AND full-suite complete before ANY rank", async () => {
  const fixture = await playFixture();
  for (const indexed of [[fixture.results[0]], [fixture.results[0], partialGame(fixture.results[1])]]) {
    const qualified = qualify(fixture, indexed);
    assert.ok(qualified.every((row) => !row.rankable && !row.campaign_complete));
    for (const game of ["2048", "minesweeper"]) {
      for (const tier of ["official", "experimental"]) {
        const ranking = buildPlayGameRanking(game, "0.7.0", qualified, tier);
        assert.ok(ranking.ranks.every((rank) => rank === undefined));
      }
    }
  }
  assert.ok(qualify(fixture).every((row) => row.rankable && row.campaign_complete));
});

test("infrastructure failure and missing trajectory evidence withhold whole-series ranks", async () => {
  const fixture = await playFixture({ scores: [0] });
  const result = structuredClone(fixture.results[0]);
  const game = result.games[1];
  game.episodes[0] = { episode_index: 0, seed: 1, status: "infrastructure-failure", action_count: 0, termination: { kind: "infrastructure-failure", reason: "browser-failure" } };
  game.coverage.completed = 9;
  delete game.metrics;
  game.trajectory_hash = playTrajectoryHash(game.task_id, game.episodes);
  assert.equal(qualify(fixture, [result])[0].rankable, false);
  const noTrajectory = structuredClone(fixture.results[0]);
  delete noTrajectory.games[0].episodes[0].trajectory_hash;
  noTrajectory.games[0].trajectory_hash = playTrajectoryHash(noTrajectory.games[0].task_id, noTrajectory.games[0].episodes);
  assert.equal(qualify(fixture, [noTrajectory])[0].rankable, false);
});

test("shared qualifier binds exact release bytes, campaign plan, configuration and seed order", async () => {
  const fixture = await playFixture({ scores: [0] });
  assert.throws(() => qualifyIndexedFlatResults(fixture.results, [{ ...fixture.context, file_hash: sha256Canonical(fixture.release) }], [fixture.plan]), /release lock/);
  assert.throws(() => qualifyIndexedFlatResults(fixture.results, [fixture.context], []), /campaign plan/);
  const changed = structuredClone(fixture.results[0]);
  changed.configuration.agent.parameters.thinking = "high";
  assert.throws(() => qualify(fixture, [changed]), /configuration/);
  const reseeded = structuredClone(fixture.results[0]);
  reseeded.games[0].episodes[0].seed = 54321;
  reseeded.games[0].trajectory_hash = playTrajectoryHash(reseeded.games[0].task_id, reseeded.games[0].episodes);
  assert.throws(() => qualify(fixture, [reseeded]), /seeds\/order/);
});

test("indexed Campaign members must bind one real source commit, including partial publication", async () => {
  const fixture = await playFixture();
  const changed = structuredClone(fixture.results);
  changed[1].git_commit = "b".repeat(40);
  assert.throws(() => qualify(fixture, changed), /commit/i);
  const partial = partialGame(changed[1]);
  assert.throws(() => qualify(fixture, [changed[0], partial]), /commit/i);
  changed[0].git_commit = "unknown";
  assert.throws(() => qualify(fixture, [changed[0]]), /commit/i);
  // Unbound observations and separate Campaigns do not share a commit constraint.
  const independent = structuredClone(fixture.results);
  independent[1].git_commit = "b".repeat(40);
  delete independent[1].campaign;
  assert.doesNotThrow(() => qualify(fixture, independent));
});

test("empty and version-correct per-game views never invent a composite or a measurement", async () => {
  const fixture = await playFixture({ scores: [42, 65], wins: [1, 7] });
  const qualified = qualify(fixture);
  const views = projectPlayReleases([fixture.context]);
  assert.equal(playVersionSelect(views, "0.7.0")?.benchmark_version, "0.7.0");
  assert.equal(playVersionSelect(views, "0.8.0"), undefined);
  assert.equal(latestPlayResultBearingVersion(views, []), undefined);
  assert.equal(latestPlayResultBearingVersion(views, qualified), "0.7.0");
  assert.deepEqual(buildPlayGameRanking("2048", "0.8.0", qualified, "official").rows, []);
  assert.deepEqual(buildPlayGameRanking("2048", "0.7.0", [], "official").ranks, []);
  const ranking = buildPlayGameRanking("minesweeper", "0.7.0", qualified, "official");
  assert.deepEqual(ranking.rows.map((row) => row.metric), [70, 10]);
  assert.equal(playGamePrimaryMetric("2048"), "mean_score");
  assert.equal(playGamePrimaryMetric("minesweeper"), "win_rate");
  assert.ok(!("composite" in ranking));
});

test("async canonical mixed index reads Play only, ignores legacy status and unindexed files", async (t) => {
  const fixture = await playFixture();
  const lite = await historicalLite();
  const build = await buildFixture(fixture);
  const files = await fixtureFiles(t, fixture, [lite, build, fixture.results[0]]);
  await files.save(`results/lite/0.7.0/${fixture.results[1].series_id}.json`, fixture.results[1]);
  await files.save("results/index.json", { this_is_not_a_legacy_index: true });
  const previous = process.env.GAMEBENCH_RESULTS_ROOT;
  process.env.GAMEBENCH_RESULTS_ROOT = path.join(files.root, "results");
  try {
    const selected = await playResults({ repositoryRoot: files.root });
    assert.equal(selected.length, 1, "async JSON reads are awaited before dispatch");
    assert.equal(selected[0].result.series_id, fixture.results[0].series_id);
    assert.equal(selected[0].rankable, false, "unindexed cell cannot make survivors rank");
    const contexts = await siteReleaseContexts(files.root);
    assert.equal(contexts[0].file_hash, fixture.context.file_hash);
    assert.notEqual(contexts[0].file_hash, sha256Canonical(fixture.release));
  } finally {
    if (previous === undefined) delete process.env.GAMEBENCH_RESULTS_ROOT;
    else process.env.GAMEBENCH_RESULTS_ROOT = previous;
  }
});

test("canonical index rejects path/identity mismatch, duplicate records, and malformed records", async (t) => {
  const fixture = await playFixture({ scores: [0] });
  const files = await fixtureFiles(t, fixture);
  const entry = { benchmark_version: "0.7.0", series_id: fixture.results[0].series_id, path: `results/lite/0.7.0/${fixture.results[0].series_id}.json` };
  await files.save("results/lite/index.json", { schema_version: 1, results: [{ ...entry, path: "results/play/other.json" }] });
  await assert.rejects(canonicalFlatResults(files.options.resultsRoot), /result path/);
  await files.save("results/lite/index.json", { schema_version: 1, results: [entry, entry] });
  await assert.rejects(canonicalFlatResults(files.options.resultsRoot), /duplicate/);
  await files.save("results/lite/index.json", { schema_version: 1, results: [entry] });
  await files.save(entry.path, { ...fixture.results[0], series_id: seriesId(500) });
  await assert.rejects(canonicalFlatResults(files.options.resultsRoot), /index mismatch/);
  await files.save(entry.path, { schema_version: 3, suite: "play" });
  await assert.rejects(canonicalFlatResults(files.options.resultsRoot));
});

test("missing canonical flat index is an honest empty Play publication state", async (t) => {
  const fixture = await playFixture();
  const files = await fixtureFiles(t, fixture, []);
  assert.deepEqual(await playResults(files.options), []);
  assert.deepEqual(await canonicalFlatResults(path.join(files.root, "absent-results")), []);
});

test("original reference assets stay bundled for model-free unranked practice", async () => {
  for (const game of ["2048", "minesweeper"]) {
    const engine = await import(`../../../benchmark/play/${game}/v1/engine.mjs`);
    const renderer = await import(`../../../benchmark/play/${game}/v1/renderer.mjs`);
    assert.equal(typeof engine.createGame, "function");
    assert.equal(typeof renderer.mountGame, "function");
  }
  const practice = await readFile(new URL("../src/components/play/PlayPractice.astro", import.meta.url), "utf8");
  assert.match(practice, /benchmark\/play\/2048\/v1\/engine\.mjs\?raw/);
  assert.match(practice, /benchmark\/play\/minesweeper\/v1\/renderer\.mjs\?raw/);
  assert.match(practice, /no model calls/);
  assert.doesNotMatch(practice, /fetch\(|\/__play-resources\//);
  const page = await readFile(new URL("../src/pages/play/[version]/[game].astro", import.meta.url), "utf8");
  assert.match(page, /\["official", "experimental"\]/);
  assert.doesNotMatch(page, /integration hook|<strong>candidate<\/strong>/);
});
