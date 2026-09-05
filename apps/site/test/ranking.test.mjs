import assert from "node:assert/strict";
import test from "node:test";

import {
  assignCompetitionRanks,
  latestResultBearingVersion,
  rankingMetricForVersion,
  rankingTierOrder,
} from "../src/lib/ranking.ts";

test("stage results lead when the Official fixture is empty", () => {
  assert.deepEqual(rankingTierOrder(0), ["experimental", "official"]);
});

test("Official results lead as soon as a qualified fixture exists", () => {
  assert.deepEqual(rankingTierOrder(1), ["official", "experimental"]);
});

test("short rankings select the newest result-bearing release instead of an empty current release", () => {
  const releases = [
    { benchmark_version: "0.5.0" },
    { benchmark_version: "0.4.0" },
    { benchmark_version: "0.3.0" },
  ];
  const records = [
    { entry: { benchmark_version: "0.3.0", status: "active" } },
    { entry: { benchmark_version: "0.4.0", status: "withdrawn" } },
  ];
  assert.equal(latestResultBearingVersion(releases, records), "0.3.0");
  assert.equal(latestResultBearingVersion(releases, []), undefined);
});

test("an unmeasured patch preserves the prior result-bearing leaderboard", () => {
  const releases = [{ benchmark_version: "0.6.1" }, { benchmark_version: "0.6.0" }];
  const historical = [{ entry: { benchmark_version: "0.6.0", status: "active" } }];
  assert.equal(latestResultBearingVersion(releases, historical), "0.6.0");
  assert.equal(latestResultBearingVersion(releases, [
    ...historical, { entry: { benchmark_version: "0.6.1", status: "active" } },
  ]), "0.6.1");
});

test("v0.5-style aggregates rank by Build while historical aggregates rank by Core", () => {
  assert.equal(rankingMetricForVersion({
    primary_board: "build",
    leaderboards: { build: 81, core: 95 },
  }), 81);
  assert.equal(rankingMetricForVersion({
    primary_board: "core",
    leaderboards: { build: 99, core: 72 },
  }), 72);
});

test("competition ranking keeps ties together and skips ranks", () => {
  assert.deepEqual(assignCompetitionRanks([95, 90, 90, 80]), [1, 2, 2, 4]);
  assert.deepEqual(assignCompetitionRanks([95, 91, 90, 90, 90, 80]), [1, 2, 3, 3, 3, 6]);
  assert.deepEqual(assignCompetitionRanks([100]), [1]);
  assert.deepEqual(assignCompetitionRanks([]), []);
});

test("missing and non-finite metrics get no rank and never tie a real zero", () => {
  // 0 is a real, valid score and is ranked; undefined is an observation with
  // no rank, so it is never tied with a scored entry and never gets rank 1.
  assert.deepEqual(assignCompetitionRanks([90, 0, undefined, undefined]), [1, 2, undefined, undefined]);
  assert.deepEqual(assignCompetitionRanks([undefined, undefined]), [undefined, undefined]);
  // NaN / Infinity / -Infinity are not a score and get no rank either.
  assert.deepEqual(assignCompetitionRanks([90, NaN, Infinity, -Infinity, undefined]), [1, undefined, undefined, undefined, undefined]);
  // All entries unscored => every position is unscored (no rank 1).
  assert.deepEqual(assignCompetitionRanks([undefined, NaN]), [undefined, undefined]);
});

test("competition ranking is order independent for equal ties", () => {
  assert.deepEqual(assignCompetitionRanks([80, 95, 90, 90]), [4, 1, 2, 2]);
  assert.deepEqual(assignCompetitionRanks([90, 90, 95, 80]), [2, 2, 1, 4]);
});
