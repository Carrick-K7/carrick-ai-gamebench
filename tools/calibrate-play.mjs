/**
 * Play reference calibration check.
 *
 * Runs the visible-only reference policies against uniform random policies for
 * both Play tasks and verifies native metric sensitivity, using the real
 * reference engines in-process (no browser, no model calls, no network):
 *
 *   - play.2048.v1       : reference mean_score > random mean_score
 *   - play.minesweeper.v1: reference win_rate  > random win_rate
 *
 * Run with `node tools/calibrate-play.mjs`. Exit status is 0 on success and 1
 * if either reference policy fails to outperform its random baseline. The
 * fixed calibration seed set is separate from any Campaign episode bundle and
 * is documented in benchmark/play/calibration/README.md.
 */

import { CALIBRATION_SEEDS, calibrate as calibrate2048 } from "../benchmark/play/calibration/2048-reference-policy.mjs";
import { CALIBRATION_SEEDS as MINE_SEEDS, calibrate as calibrateMine } from "../benchmark/play/calibration/minesweeper-reference-policy.mjs";

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function report2048() {
  const { referenceScores, randomScores } = calibrate2048(CALIBRATION_SEEDS);
  const referenceMean = mean(referenceScores);
  const randomMean = mean(randomScores);
  const referenceWins = referenceScores.filter((score, i) => score > randomScores[i]).length;
  const ok = referenceMean > randomMean && referenceMean - randomMean > 100 && referenceWins >= 6;
  console.log(`[play.2048.v1] mean_score reference=${referenceMean.toFixed(1)} random=${randomMean.toFixed(1)} (reference beats random on ${referenceWins}/${CALIBRATION_SEEDS.length} seeds)`);
  if (!ok) {
    console.error("  FAIL: visible-only 2048 reference did not beat the random baseline");
  }
  return ok;
}

function reportMine() {
  const { referenceWins, randomWins } = calibrateMine(MINE_SEEDS);
  const referenceRate = referenceWins.filter(Boolean).length / MINE_SEEDS.length;
  const randomRate = randomWins.filter(Boolean).length / MINE_SEEDS.length;
  const ok = referenceRate > randomRate && referenceRate > 0.5 && randomRate < 0.5;
  console.log(`[play.minesweeper.v1] win_rate reference=${referenceRate.toFixed(2)} random=${randomRate.toFixed(2)} (${referenceWins.filter(Boolean).length}/${MINE_SEEDS.length} wins)`);
  if (!ok) {
    console.error("  FAIL: visible-only minesweeper reference did not beat the random baseline");
  }
  return ok;
}

const ok2048 = report2048();
const okMine = reportMine();

if (ok2048 && okMine) {
  console.log("Play reference calibration passed for both tasks.");
  process.exit(0);
}
process.exit(1);
