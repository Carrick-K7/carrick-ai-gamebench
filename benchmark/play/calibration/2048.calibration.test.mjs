import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_SEEDS,
  calibrate,
  playReference,
  playRandom,
} from "./2048-reference-policy.mjs";

test("2048 calibration: reference policy is deterministic", () => {
  for (const seed of CALIBRATION_SEEDS) {
    const a = playReference(seed);
    const b = playReference(seed);
    assert.equal(a.score, b.score);
    assert.equal(a.effective_moves, b.effective_moves);
  }
});

test("2048 calibration: random policy is deterministic given a fixed rng seed", () => {
  const a = playRandom(CALIBRATION_SEEDS[0], 123);
  const b = playRandom(CALIBRATION_SEEDS[0], 123);
  assert.equal(a.score, b.score);
});

test("2048 calibration: visible-only reference outperforms random by mean_score", () => {
  const { seeds, referenceScores, randomScores } = calibrate(CALIBRATION_SEEDS);
  assert.equal(seeds.length, 10);
  for (const score of referenceScores) assert.deepEqual(collectNaN(score), []);
  for (const score of randomScores) assert.deepEqual(collectNaN(score), []);
  const referenceMean = mean(referenceScores);
  const randomMean = mean(randomScores);
  assert.ok(referenceMean > randomMean, `expected referenceMean ${referenceMean} > randomMean ${randomMean}`);
  assert.ok(referenceMean - randomMean > 100, "the visible-only advantage should be non-trivial");
  // The reference should beat random on a strict majority of seeds.
  const referenceWins = referenceScores.filter((s, i) => s > randomScores[i]).length;
  assert.ok(referenceWins >= 6, `reference beat random on only ${referenceWins} of ${seeds.length} seeds`);
});

function collectNaN(value) {
  if (typeof value === "number" && !Number.isFinite(value)) return [value];
  return [];
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
