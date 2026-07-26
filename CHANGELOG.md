# Changelog

All notable benchmark changes are recorded here. Releases also have a
machine-readable lock under `benchmark/releases/`.

## Unreleased

- Added semantic-versioned Leaderboard, game-catalog, task, release, immutable
  result, and isolated Showcase pages without changing benchmark scoring.
- Added exact-hash resolution of retained historical task sources and explicit
  lock-only rendering when an early source snapshot is unavailable.
- Added deterministic fixed-seed Showcase capture during clean reproduction.
- Strengthened Publication validation for object tampering, missing objects,
  release/task isolation, licenses, supersession, index consistency, and
  semantic version order.
- Defined the public Monorepo, private Ops, object storage, raw-run storage,
  GitHub governance, result submission, and static-build promotion boundaries.

## 0.3.0

- Activated eight v2 tasks and retained the unchanged v0.2 task sources under
  `benchmark/retired/0.2.0/`.
- Copied the complete public test suite and scored task manifest into every
  Agent workspace.
- Applied each official run seed to ordinary resets and added a scored snapshot
  assertion so repeated seeds are different evaluator inputs.
- Changed Core from a task-count-weighted mean to an equal 50/50 mean of the
  Build and Reproduce track scores, recorded as aggregate schema v2.
- Replaced absolute screenshot pixel allowances with calibrated image-area
  ratios for Reproduce tasks.
- Defined coding timeout as an evaluated deadline snapshot while excluding
  Agent and evaluator errors from Official publication.

## 0.2.0

- Added immutable series, run, verification, publication, artifact, review, and
  result-index contracts with canonical SHA-256 identities.
- Replaced self-declared `official` and `verified` run flags with
  `official-candidate` execution and independent operator verification.
- Added the publisher package, clean-source export, secret scanning,
  deterministic public artifacts, content-addressed filesystem storage, and
  publication validation.
- Added the static public GameBench site with Official and Experimental result
  separation, game pages, playable embeds, methodology, source, and releases.
- Kept legacy run and release-lock readers for the 0.1.x history.

## 0.1.2

- Copied each task's public state schema into fresh submission workspaces.
- Isolated submission installs from the repository pnpm workspace.
- Allocated evaluator preview ports dynamically to avoid unrelated services.
- Preloaded and verified standalone starter dependencies in the evaluator image.

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
