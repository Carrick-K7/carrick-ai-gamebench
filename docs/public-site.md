# Public site product design

## Scope

The GameBench site is a read-only, statically generated view of audited
benchmark releases and publications. Its v0.5 priorities are:

1. show how an exact Agent configuration satisfies public machine contracts;
2. present the Build primary leaderboard without hidden composite weighting;
3. report Reproduce independently;
4. connect every score to the exact submission, seed evaluations, source,
   evidence, release, and playable output.

The site does not execute models, accept submissions, collect votes, or require
accounts. `gamebench.ai.carrick7.com` is the trusted presentation origin and
`play.gamebench.ai.carrick7.com` is the untrusted playable/object origin.

## Product principles

- Lead with deterministic machine contract results. Human playtesting, when
  present, is an optional qualitative annotation below the scored evidence.
- Build is the canonical v0.5 ranking. Reproduce has its own report and never
  changes Build order, qualification, or tie-breaking.
- A model name is not a result. Show exact model parameters, Agent and harness,
  Benchmark version, source snapshot, and execution environment.
- Explain the v0.5 topology plainly: one Agent invocation creates one submission
  per task; the same frozen source is evaluated under three fixed seeds in
  fresh environments.
- Display each submission once. Seed evaluations are conditions and evidence
  rows, not three different model-made games.
- A score leads to its game, clean source, failed checks, publication, and
  license. Failed and zero-score submissions remain visible.
- Never choose the highest seed score for display. The release presentation seed
  may choose the default playable while every included evaluation stays
  selectable.
- Keep Official and Experimental evidence visibly distinct.
- Keep machine score, reliability, wall time, development usage/cost, optional
  human annotation, and publication trust separate.
- Never rank different `benchmark_version` values together.
- Build does not claim creativity, aesthetics, novelty, or fun. Link to any
  future Creative benchmark as a separate product, not another GameBench track.
- Public pages read only release locks, publication manifests, active/retired
  task sources resolved by exact hash, and content-addressed artifacts. They
  never read `runs/`.

## Information architecture

| Route | Purpose | v0.5 primary content |
| --- | --- | --- |
| `/` | Current overview | Current release, latest comparable Build results, machine-contract explanation, featured outputs, and Reproduce entry |
| `/leaderboard` | Current shortcut | Current-version Build leaderboard with canonical versioned URL |
| `/benchmarks/<version>/leaderboard` | Versioned canonical board | Build score, task and seed coverage, variation, qualification, exact Agent configurations |
| `/reproduce` | Current shortcut | Current-version Reproduce report |
| `/benchmarks/<version>/reproduce` | Versioned Reproduce report | Reproduce scores, coverage, reference/license context, visual and behavioral evidence |
| `/experimental` | Non-ranking evidence | Partial, pilot, missing-seed, and unverified publications with explicit limitations |
| `/games` | Current task shortcut | Current Build and Reproduce catalog, visibly grouped |
| `/benchmarks/<version>/games` | Versioned task catalog | Track, contract categories, point allocation, output count |
| `/benchmarks/<version>/games/<task-id>` | Task across submissions | Contract, exact release identity, one card per submission, seed evaluation selector |
| `/results/<publication-id>` | Immutable result | Submission gallery, per-seed evidence, board scores, failures, telemetry, optional annotations, identities |
| `/showcase/<artifact-id>` | Immutable playable wrapper | Cover, isolated iframe, controls, selected evaluation, source/result/license links |
| `/methodology` | Measurement contract | Machine evaluation, submission/evaluation topology, aggregation, tiers, limitations |
| `/releases` | Version ledger | Current and archived releases, compatibility, primary board, protocol changes |
| `/releases/<version>` | One release | Frozen catalog, board policy, Agent invocation count, evaluation seeds, schema generations, comparison warning |
| `/source` | Open implementation | Repository, evaluator, tasks, result data, licenses, security boundary |

The short routes `/leaderboard`, `/reproduce`, and `/games` remain stable current-
version entry points. Their canonical URLs include the selected Benchmark
version. Immutable `/results/<publication-id>` and `/showcase/<artifact-id>` do
not need a version segment and must never redirect to a replacement identity.

Existing `/experimental`, `/games`, and `/games/<task-id>` URLs remain valid.
If a historical short task URL no longer exists in the current release, it
resolves to the newest release containing that exact task ID rather than 404.

## Home

The home page distinguishes:

- the current Benchmark release;
- the latest release with comparable Build results, when different;
- the primary Build machine-contract leaderboard;
- a separate Reproduce summary and link;
- one featured task and deterministic output covers;
- counts for active tasks, public publications, and playable artifacts;
- last publication-ledger refresh and `site_build_id`;
- direct links to methodology, release rules, and source.

The hero and primary calls to action describe specification compliance and
browser evidence, not a human verdict. An empty current Build board points to
Experimental evidence and, if applicable, the latest older release with results
without presenting that older score as current.

## Build leaderboard

One exact Benchmark version is selected before rows are sorted. For v0.5, rows
rank only by complete Build machine score. Each row represents an exact Agent
configuration, not a model-family average, and shows:

- Build score and Build task coverage;
- fixed-seed evaluation coverage;
- task-level mean and population standard deviation;
- Official or Experimental qualification and verification;
- development usage/cost and evaluation wall time when reported;
- an immutable result link.

Reproduce, human annotation, cost, and wall time are not Build tie-breaks.
Missing telemetry is **Not reported**, excluded from efficiency summaries, and
never converted to zero.

## Reproduce report

The Reproduce page uses the same exact-version isolation but is not the primary
leaderboard. It shows Reproduce task means, fixed-seed variation, behavior and
visual categories, reference provenance, and license constraints. Reference and
generated screenshots may appear side by side only when redistribution is
permitted.

Reproduce completion does not raise, lower, or qualify a Build row. Build
completion likewise must not be presented as a Reproduce result.

## Experimental evidence

`/experimental` is an independent non-ranking discovery page, not a duplicate
of the leaderboard. Every card names its limitation, such as:

- one submission but fewer than three seed evaluations;
- incomplete task coverage;
- clean reconstruction completed without independent operator verification;
- local network attestation only;
- evaluation error or missing artifact.

Experimental result detail uses the same evidence component as Official data,
but it never receives an Official rank number.

## Games and generated outputs

There are two browse modes:

1. model-first: one result page shows all task submissions from one exact
   configuration;
2. task-first: one task page compares submissions from different configurations
   under the same release contract.

A v0.5 output card represents one submission and contains:

- deterministic 16:9 cover;
- model, Agent, harness, and reasoning settings;
- Official/Experimental state;
- task mean, seed coverage, and variation;
- development exit state;
- **Play**, **Source**, and **Result details** actions;
- explicit failure state when no playable exists.

Within the card, seeds `104729`, `130363`, and `155921` select evaluations of the
same source snapshot. The UI names the selected physical `run_id` and score but
does not imply that the Agent developed the game three times. The presentation
seed defaults to `104729` unless the selected release declares otherwise.

The iframe loads only after user action. The trusted wrapper may offer reload,
fullscreen, and open-in-new-window controls, but it does not inject code into
the game and cannot grant access to trusted-origin storage.

## Result detail

A v0.5 result header contains:

- exact model parameters, Agent, and harness;
- Benchmark release and publication tier;
- Build as the primary board score when complete;
- Reproduce only as an independent report when present;
- task coverage, evaluation coverage, verification, and publication status.

The body contains:

- one generated-game card per submission, including failures;
- `submission_id`, development input identity, and `source_snapshot_hash`;
- all seed evaluations with `run_id`, score, exit state, and evidence;
- task mean, population deviation, and category contribution;
- failed browser checks and public screenshots;
- development usage/cost once per submission and evaluation timing per seed;
- clean source, playable, license, and evidence links;
- optional human annotation in a subordinate, clearly non-scoring section;
- publication, configuration, release-lock, source-commit, image-digest, and
  artifact identities.

Superseded and withdrawn publications remain addressable with a prominent status
banner and replacement link where one exists.

## Historical rendering

Version-aware presentation is mandatory:

- v0.1-v0.4 leaderboard pages retain their released Core/Build/Reproduce labels
  and original ranking rule;
- their fixed seeds remain three fresh Agent development runs, not evaluations
  of one source snapshot;
- legacy result pages remain run-oriented and may display historical human
  summaries;
- v0.5 pages use submission-oriented galleries, Build-first ranking, and
  independent Reproduce reporting.

Do not globally relabel old `attempts` as evaluations or old Core as Build. The
data layer normalizes legacy and v0.5 manifests into explicit view models while
preserving their different meanings.

## Version and release model

The site treats these identities independently:

- `benchmark_version` defines score comparability;
- task version and hash identify the task contract;
- release-lock schema identifies execution and board policy;
- result schema controls parsing;
- `site_build_id` identifies presentation code.

Release pages derive human-readable diffs from adjacent locks, including:

- tasks added, removed, or changed;
- scoring and aggregation generations;
- primary-board and independent-report policy;
- Agent invocations per task;
- evaluation seeds and fresh-environment topology;
- run, submission, series, publication, and bridge protocol generations;
- human annotation policy and Creative scope boundary.

Task sources for versioned pages resolve from the selected release lock against
active or retired content by exact hash. A newer source is never substituted
for a missing historical version.

## Static data and validation

Astro builds from:

```text
benchmark/releases/*.json
results/index.json
results/publications/*.json
public object references
active and retired versioned task metadata
```

The build validates schemas, identities, index links, release compatibility,
task hashes, object existence, and semantic release order. Derived category or
efficiency views do not create another scoring contract.

`results/index.json` is the mutable discovery ledger. Publication manifests and
content-addressed objects are immutable facts. Corrections create a new
publication and mark the old entry superseded; withdrawals do not delete pages.

## Refresh flow

A new Benchmark release merges validated protocol/task changes, generates an
append-only release lock, tags the matching version, builds all versioned pages,
and becomes visible even when its Build board is empty. Only this flow changes
`benchmark_version`.

A new result completes the private series, reconstructs clean source, verifies
all included evaluations, uploads content-addressed objects, generates an
immutable publication, updates the discovery ledger through review, and then
rebuilds the static site.

Copy, accessibility, styling, and other presentation-only changes update
`site_build_id` without changing benchmark identity.

## Future Creative site boundary

A future Creative benchmark receives an independent route namespace, benchmark
identity, release ledger, result index, methodology, qualification, and
leaderboard. It may be cross-linked from GameBench but is never rendered as a
third Build/Reproduce track or combined into GameBench scores.

## Acceptance criteria

- No page ranks different Benchmark versions together.
- v0.5 Build rank depends only on complete Build machine scores.
- Reproduce is independent and never used as a Build hidden weight or tie-break.
- Every v0.5 task card represents one submission and exposes all seed
  evaluations of the identical snapshot.
- No gallery cherry-picks the highest seed score.
- Historical v0.1-v0.4 pages retain their original Core and fresh-run meaning.
- All legacy short routes and immutable result/showcase URLs remain valid.
- Every score links to an immutable result; every playable links back to score,
  source, publication, and license.
- Failed tasks remain visible and missing telemetry is not zero.
- Human annotation is optional, subordinate, and explicitly non-scoring.
- Invalid hashes, unknown schemas, missing objects, or release mismatch fail the
  site build.
- Superseded and withdrawn results remain accessible.
- Untrusted game code cannot reach trusted-origin DOM, cookies, storage, or
  network.
- Primary scores and methodology remain readable without client-side JavaScript;
  only the interactive player requires it.
