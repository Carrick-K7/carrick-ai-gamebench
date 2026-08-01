import assert from "node:assert/strict";
import test from "node:test";

import { rankingTierOrder } from "../src/lib/ranking.ts";

test("stage results lead when the Official fixture is empty", () => {
  assert.deepEqual(rankingTierOrder(0), ["experimental", "official"]);
});

test("Official results lead as soon as a qualified fixture exists", () => {
  assert.deepEqual(rankingTierOrder(1), ["official", "experimental"]);
});
