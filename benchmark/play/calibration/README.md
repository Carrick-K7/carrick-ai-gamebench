# Play reference calibration

These calibration checks prove that a policy using **only visible
information** (`publicState`) outperforms a uniform random policy on a fixed
calibration seed set under each task's native metric. They are **calibration
baselines only** — they are not model player implementations and never take
part in ranking.

The reference policies drive the real reference engine through the same engine
command contract a native player uses. They are deterministic and reproducible.
The command stream and score/win outcomes are recomputable from the seed.

## 2048

`2048-reference-policy.mjs` exports `playReference(seed, maxDecisions)` and
`playRandom(seed, rngSeed, maxDecisions)`.

- Reference: deterministic 1-ply expectimax over the 9:1 `2`/`4`-spawn
  distribution, scored by a weighted-corner + empty-cell + smoothness
  heuristic. It reads only `publicState().board`.
- Random: uniform direction sampling from a separately seeded RNG.

Metric: `mean_score`. The test asserts the reference mean exceeds the random
mean by a non-trivial margin and beats random on a strict majority of the ten
calibration seeds.

## Minesweeper

`minesweeper-reference-policy.mjs` exports `playReference(seed, maxDecisions)`
and `playRandom(seed, rngSeed, maxDecisions)`.

- Reference: opens at the center, then applies deterministic constraint
  propagation (a revealed number with zero remaining mines reveals all hidden
  neighbours; a number surrounded by exactly its remaining mines flags all
  of them; plus pairwise subset deduction), and only guesses by probability
  when nothing is provable. It reads only `publicState()` — never `snapshot()`.
- Random: uniformly samples a hidden cell each step from a separately seeded
  RNG.

Metric: `win_rate`. The test asserts the reference win rate exceeds the random
win rate and clears a bare-majority baseline. On the documented calibration set
with the default 128-decision budget the reference typically wins most of the
ten boards (roughly 8/10, against a random policy that wins 0/10).

## Calibration seeds

The fixed calibration seed set is deliberately **separate** from any Campaign
episode seed bundle:

- 2048: `101, 202, 303, 404, 505, 606, 707, 808, 909, 1001`
- minesweeper: `101, 202, 303, 404, 505, 606, 707, 808, 909, 1001`

These are fixed and documented here so results remain reproducible. They never
reach player prompts or screenshots.

## In-process check

`node tools/calibrate-play.mjs` runs both calibrations against the real
reference engines (no browser, no model calls) and exits non-zero if either
reference policy fails to beat its random baseline. The granular assertions are
also expressed as node:test files (`2048.calibration.test.mjs`,
`minesweeper.calibration.test.mjs`).
