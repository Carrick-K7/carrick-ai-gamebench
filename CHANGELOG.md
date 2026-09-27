# Changelog

All notable benchmark changes are recorded here. Releases also have a
machine-readable lock under `benchmark/releases/`.

## 0.7.0

- Split the brand into independent Build and Play suites, without a composite score.
- Preserve the complete 0.6 Build instrument, task hashes, historical results and URLs.
- Add ReleaseLock v4, flat result v3 and single-suite Campaign v2 in the existing canonical directories.
- Add original deterministic 2048 and Minesweeper references, bounded screenshot/native-input episodes, sealed evidence and model-free engine/browser replay.
- Commit private paired seed bundles before execution; gate ranking/publication on whole-series and whole-Campaign completeness.
- Add an external isolated no-tools Pi player adapter, separate Play rankings and unranked responsive practice.
- Correct homepage counts, competition ties and conditional artifact/playable availability.
- Enforce one Git commit across every Campaign cell through shared execution, publication and public-reader checks.
- Use one atomic snapshot publisher for legacy and current results, with immutable indexed records and byte-identical orphan recovery only.
- Share the Build task batch policy, construct new results directly as v3, and display flat Build results without synthetic legacy entities.
- Reuse unchanged Play evidence file hashes within one check while retaining nested seal, filesystem, tampering and native replay validation.
- No paid model measurements or production deployment accompany this release.

## 0.6.1

Quality-control and auditability patch to the 0.6.0 development baseline. No
changes to the four task contracts, seed, time budget, gates, points, or scoring
interpretation. The new release lock differs from 0.6.0 only in its version.

- Reject duplicate/unsafe case IDs, assertion-free browser cases, duplicated or
  unscored case coverage, and mismatched build-gate references before execution.
- Calibrate Texas Hold'em with two identical-source positive controls and four
  real source mutants covering short all-ins, odd chips, wheel straights, and
  native Check input. Mutants must fail their target case without failing build.
- Display tied competition ranks, per-task scores and hard gates, provider and
  thinking settings, Campaign provenance, and single-sample comparison limits.
- Preserve historical result and Campaign validation against each record's own
  immutable release lock while new runs default to 0.6.1. No prior result,
  Campaign, source hash, or score is relabeled or rewritten.
- Add `cagb --version` / `-V`, patch-instrument identity tests, and release notes.
- Install Chromium explicitly in every full-check workflow; retain cold-cache
  starter coverage and reject changed evidence on a GitHub Release retry.
- Replace stale automatic SSH deployment with a static-build artifact upload,
  honoring the repository's no-production-runtime boundary.
- Document measurement gaps and defer outcome-changing evaluator fixes to a
  future minor release. No new production runtime or deployment is introduced.

## 0.6.0 (development baseline)

- Replaced the multi-track, three-evaluation workflow with four Build tasks, one
  Agent invocation, one frozen source archive, and one canonical-seed evaluation
  per task.
- Added the six-player Texas Hold'em task and a 100/100 deterministic calibration
  implementation covering betting, short all-ins, ranking, side/split pots,
  rotation, input, bot cadence, and chip conservation.
- Added the lightweight `doctor`, `bench`, `check`, and `publish` CLI, flat
  `result.json`, local evidence manifests, score recomputation, and Git result
  index.
- Added enforced preregistered Campaign Plans, tracked Pi invocation adapters,
  preallocated single-use series IDs, schema-v2 Campaign bindings, durable series
  phase markers, and locked atomic batch publication.
- Extended Campaign schema v1 compatibly to support a one-cell Official
  measurement (`vary: []`) without changing historical plan hashes; multi-cell
  Campaigns remain explicitly comparative.
- Added one-lock publication of multiple completed Campaigns and retained
  evidence validation for clean Official runs whose recorded Git commit remains
  available after later protocol-only commits.
- Removed the Docker evaluator, independent verifier, Reproduce default catalog,
  legacy publisher package, and legacy evaluator CLI workflow.
- Updated the static site and documentation around the 0.6 trust boundary:
  project-operated canonical execution rather than independent reproduction.

## 0.5.0

- Changed the Official execution topology from three fresh Agent development
  attempts per task to one Agent invocation and one sealed submission per task.
  The identical source snapshot is evaluated under seeds `104729`, `130363`,
  and `155921` in three freshly materialized, isolated environments.
- Separated submission identity, development usage, and source snapshot hashes
  from per-seed evaluation runs, scores, timing, and evidence. Seeds are now
  evaluation conditions rather than development inputs.
- Made deterministic machine contract evaluation the primary benchmark product.
  Build is the canonical leaderboard; Reproduce is reported independently and
  no longer contributes to a new Core ranking.
- Made human playtesting an optional, non-scoring qualitative annotation. It
  does not affect qualification, Build rank, or Reproduce score.
- Declared creativity, novelty, aesthetics, and fun outside GameBench's trusted
  score. A future Creative benchmark will use a separate benchmark identity,
  methodology, release ledger, result index, and leaderboard.
- Added new release, series, run/evaluation, aggregate, and publication contract
  generations for v0.5 while retaining v0.1-v0.4 readers and immutable history.
- Made Build and Reproduce board-scoped publications so each qualifies and is
  reported independently. Official task development cannot be retried within a
  series; a retry requires a new series and therefore a new auditable sample.

## 0.4.0

- Restricted evaluated games to their assigned loopback origin and blocked
  runtime WebSocket and service-worker escape paths.
- Rebuilt and previewed submissions with an explicit environment allowlist so
  provider credentials and process-injection variables cannot reach untrusted
  package scripts or generated games.
- Rejected task paths that escape their versioned package and scanned generated
  playable bundles for credentials before publication.

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
