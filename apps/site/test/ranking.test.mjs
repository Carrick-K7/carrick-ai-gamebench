import assert from "node:assert/strict";
import test from "node:test";

import {
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
