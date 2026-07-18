# Changelog

All notable benchmark changes are recorded here. Releases also have a
machine-readable lock under `benchmark/releases/`.

## 0.1.1

- Simplified the public protocol by removing unused source assertions, bridge
  scenario labels, network modes, and browser operations.
- Rejected stale task hashes during evaluation, aggregation, and human-review
  candidate discovery.
- Hardened evidence verification against duplicate, unlisted, incomplete, and
  mismatched artifacts.
- Removed reviewer scripts that did not start a usable review service, and
  enabled compiler checks for unused code.

## 0.1.0

- Established Build and Reproduce as the complete public benchmark surface.
- Added six Build games: 2048, Minesweeper, 2D Parking, Tetris,
  Side-scroller Shooter, and Tower Defense.
- Added licensed Reproduce tasks for OhSteem and Radius Raid.
- Added deterministic browser scoring, evidence bundles, three-attempt
  official candidates, and blinded pairwise human review.
- Added task-level content hashes and benchmark release locks.
- Removed the experimental Iterate track before the first public release.
