import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relative) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("leaderboard shortcuts select the latest result-bearing version and canonicalize to it", async () => {
  const [leaderboard, experimental] = await Promise.all([
    source("../src/pages/leaderboard.astro"),
    source("../src/pages/experimental.astro"),
  ]);
  for (const page of [leaderboard, experimental]) {
    assert.match(page, /latestResultBearingVersion\(releases, results\.records\)/);
    assert.match(page, /canonicalPath=\{`\/benchmarks\/\$\{selectedVersion\}\/leaderboard`\}/);
    assert.match(page, /version=\{selectedVersion\}/);
    assert.match(page, /isShortcut/);
  }
});

test("current game shortcuts keep v0.5 task identity and canonical versioned URLs", async () => {
  const [games, game] = await Promise.all([
    source("../src/pages/games/index.astro"),
    source("../src/pages/games/[id].astro"),
  ]);
  assert.match(games, /canonicalPath=\{current \? `\/benchmarks\/\$\{current\.release\.benchmark_version\}\/games`/);
  assert.match(games, /is the current release/);
  assert.match(games, /no result has been published for this release yet/);
  assert.match(game, /canonicalPath=\{`\/benchmarks\/\$\{catalog\.release\.benchmark_version\}\/games\/\$\{taskId\}`\}/);
});

test("versioned ranking pages retain historical Core and three-attempt semantics", async () => {
  const [rankings, leaderboard] = await Promise.all([
    source("../src/components/RankingsPage.astro"),
    source("../src/components/LeaderboardView.astro"),
  ]);
  assert.match(rankings, /compareSemanticVersions\(version, "0\.5\.0"\) >= 0/);
  assert.match(rankings, /historical result completes all three fixed attempts/);
  assert.match(leaderboard, /<th>Core<\/th><th>Build<\/th><th>Reproduce<\/th>/);
  assert.match(leaderboard, /entry\.aggregate\.leaderboards\.core/);
});

test("v0.5 board and shared-submission routes stay unambiguous", async () => {
  const [rankings, data, result, showcase] = await Promise.all([
    source("../src/components/RankingsPage.astro"),
    source("../src/lib/data.ts"),
    source("../src/pages/results/[id].astro"),
    source("../src/pages/showcase/[id].astro"),
  ]);
  assert.match(rankings, /activeForVersion\.filter\(\(\{ entry \}\) => entry\.tier === "official"\)/);
  assert.match(rankings, /tier="official" board="reproduce"/);
  assert.match(data, /rawPublication\.schema_version !== indexedPublicationSchema/);
  assert.match(data, /rawEntry\.board !== rawPublication\.board/);
  assert.match(result, /href=\{`#evaluation-\$\{run\.run_id\}`\}>Evidence/);
  assert.match(showcase, /Frozen submission/);
  assert.match(showcase, /Evaluation records/);
});

test("immutable historical result and showcase paths remain keyed by existing identities", async () => {
  const [result, showcase] = await Promise.all([
    source("../src/pages/results/[id].astro"),
    source("../src/pages/showcase/[id].astro"),
  ]);
  assert.match(result, /record\.publication\.publication_id\.slice\("sha256:"\.length\)/);
  assert.match(showcase, /artifactId\.slice\("sha256:"\.length\)/);
  assert.match(showcase, /\/results\/\$\{entry\.publication_id\.slice\(7\)\}/);
});
