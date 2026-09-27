import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_SEEDS,
  calibrate,
  playReference,
  playRandom,
} from "./minesweeper-reference-policy.mjs";

test("minesweeper calibration: reference policy is deterministic", () => {
  for (const seed of CALIBRATION_SEEDS) {
    const a = playReference(seed);
    const b = playReference(seed);
    assert.equal(a.won, b.won);
    assert.equal(a.revealed_safe, b.revealed_safe);
  }
});

test("minesweeper calibration: random policy is deterministic given a fixed rng seed", () => {
  const a = playRandom(CALIBRATION_SEEDS[0], 123);
  const b = playRandom(CALIBRATION_SEEDS[0], 123);
  assert.equal(a.won, b.won);
  assert.equal(a.revealed_safe, b.revealed_safe);
});

test("minesweeper calibration: visible-only reference outperforms random by win_rate", () => {
  const { seeds, referenceWins, randomWins } = calibrate(CALIBRATION_SEEDS);
  assert.equal(seeds.length, 10);
  const referenceRate = referenceWins.filter(Boolean).length / seeds.length;
  const randomRate = randomWins.filter(Boolean).length / seeds.length;
  assert.ok(referenceRate > randomRate, `expected referenceRate ${referenceRate} > randomRate ${randomRate}`);
  assert.ok(referenceRate > 0.5, `referenceRate ${referenceRate} should clear a bare-majority baseline`);
  assert.ok(randomRate < 0.5, `randomRate ${randomRate} should be below the majority baseline`);
});

test("minesweeper calibration: a won reference game reveals every safe cell", () => {
  for (const seed of CALIBRATION_SEEDS) {
    const outcome = playReference(seed);
    if (outcome.won) assert.equal(outcome.revealed_safe, outcome.safe_cells);
  }
});
