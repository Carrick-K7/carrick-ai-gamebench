# Public site product design

## Scope

The first public GameBench site is a read-only, statically generated view of
audited benchmark releases and publications. It exists to answer four
questions:

1. How well did an exact model and Agent configuration score?
2. What can a person actually play?
3. Why did each game receive its score?
4. Which source, methodology, release, and evidence produced the result?

The site does not execute models, accept submissions, collect votes, or require
accounts. `gamebench.ai.carrick7.com` remains the trusted presentation origin
and `play.gamebench.ai.carrick7.com` remains the untrusted playable and object
origin.

## Product principles

- Lead with a playable game, a human game title, and a plain-language score.
  Task IDs, seeds, hashes, schemas, and artifact records remain available but
  belong in progressive-disclosure audit sections rather than primary page
  headings.
- Every public page should answer one ordinary-language question before it
  explains implementation detail. Prefer “browser check” to “atomic test,”
  “game challenge” to “task contract,” and “version rules” to “release lock”
  outside auditor-facing sections.
- An empty Official leaderboard must direct visitors to playable Experimental
  evidence and explain the qualification gap; it must not be the main home-page
  call to action before Official results exist.
- A model name is not a result. The visible identity is the exact model,
  reasoning settings, Agent version, harness, Benchmark version, and execution
  environment.
- A score should lead to a game, and a game should lead back to its score,
  clean source, publication, and license.
- Official and Experimental results are separate products, not filters on one
  ambiguous leaderboard.
- Machine score, human review, wall time, token usage, and cost stay separate.
- Failed and zero-score games remain visible. The gallery must not show only
  successful outputs.
- The site never chooses the best seed for display. An Official result defaults
  to seed `104729` and lets readers select the other fixed seeds.
- Cross-version history is useful, but scores from different Benchmark
  versions are not directly ranked together.
- Public pages use only release locks, publication manifests, and public
  content-addressed artifacts. They never read `runs/`.

## Information architecture

| Route | Purpose | Primary content |
| --- | --- | --- |
| `/` | Current public overview | Current release, latest comparable Official results, featured playable outputs, scope, and trust model |
| `/benchmarks/<version>/leaderboard` | Canonical Official leaderboard | Core/Build/Reproduce, exact Agent variants, coverage, reliability, and efficiency views |
| `/experimental` | Non-ranking evidence | Partial, pilot, single-seed, and unverified publications with explicit limitations |
| `/benchmarks/<version>/games` | Versioned game catalog | Track, level, capability categories, point allocation, and public output count |
| `/benchmarks/<version>/games/<task-id>` | One game across models | Task contract, reference and license, test map, output gallery, seed selector, and optional side-by-side comparison |
| `/results/<publication-id>` | Immutable model/series result | Exact configuration, aggregate scores, task and seed breakdown, failures, telemetry, human summaries, and generated-game gallery |
| `/showcase/<artifact-id>` | Trusted wrapper for one output | Cover image, metadata, isolated on-demand iframe, controls, score, source, and result links |
| `/methodology` | Public measurement contract | Execution, scoring, aggregation, human review, publication tiers, and limitations |
| `/releases` | Version ledger | Release list, compatibility status, task/protocol/scoring changes, and content hashes |
| `/releases/<version>` | One release | Frozen catalog, fixed seeds, change summary, Git tag, and comparison warning |
| `/source` | Open implementation | Repository, evaluator, task definitions, public result data, licenses, and security boundary |

The short routes `/leaderboard` and `/games` may present a current-version
landing page, but links and canonical URLs should include the Benchmark
version. `/results/<publication-id>` and `/showcase/<artifact-id>` are already
immutable by identity and do not need a version segment.

## Page content

### Home

The home page should be useful even when the newest release has no Official
results yet:

- current Benchmark release and release date;
- latest release that has comparable Official results, if different;
- top Official configurations with Core, Build, and Reproduce visible
  together;
- one featured task and several deterministic output covers;
- a concise explanation of Build, Reproduce, machine scoring, and human
  playtesting;
- counts for active tasks, public publications, and playable artifacts;
- last publication-ledger refresh and `site_build_id`;
- direct links to play, inspect methodology, and read source.

### Official leaderboard

One exact Benchmark version is selected before rows are sorted. The default
view ranks by Core and always shows Build and Reproduce beside it. Alternate
views expose:

- score by track;
- category evidence derived from atomic tests, such as Mechanics, State,
  Input, Stability, Feel, and Visual;
- wall time per task and per complete series;
- token usage and cost when reported;
- Agent/harness comparison while holding the model constant.

Missing telemetry is shown as **Not reported**, excluded from efficiency
aggregates, and never treated as zero. Every row represents an Agent variant,
not a model family average. A compact “What this metric means” explanation
travels with each view.

### Experimental

Experimental publications use the same result detail component but never
appear in the Official rank. Each card names its limitation, for example:

- one seed instead of three;
- incomplete task coverage;
- clean rebuild completed but no independent operator verification;
- local network attestation only.

### Games and generated outputs

There are two equally important ways to browse generated games:

1. Model-first: a result page shows all required games produced by one exact
   configuration.
2. Game-first: a game page shows different configurations solving the same
   task under one Benchmark version and seed.

An output card contains:

- deterministic 16:9 showcase cover;
- model, Agent, harness, and reasoning setting;
- Official or Experimental tier and verification state;
- task score, selected seed, exit reason, and publication date;
- **Play**, **Source**, and **Result details** actions;
- an explicit failure state when no playable artifact exists.

The Publisher should capture one deterministic showcase screenshot from the
clean rebuilt playable, using the fixed viewport, seed, and task presentation
state. It can remain a `screenshot` artifact named
`<task-id>-showcase.png`; no new result schema is required. Failure screenshots
must never be selected as the cover.

The iframe loads only after user action so a gallery does not execute many
untrusted games at once. The trusted wrapper may offer reload, fullscreen, and
open-in-new-window controls, but it does not inject code into the game. It uses
the existing sandbox and isolated `play` origin.

For an Official publication:

- seed `104729` is the default playable;
- `130363` and `155921` are selectable;
- the site never selects the highest-scoring attempt;
- mean and standard deviation describe the task while the player clearly
  names the physical run being shown.

For Reproduce tasks, the page may show reference and generated screenshots
side by side when the upstream license permits redistribution. Visual
pass/fail and threshold metadata are shown separately from interactive
playability. Reference material that cannot be redistributed is represented by
metadata and an upstream link only.

An optional read-only compare mode can place two same-task, same-version,
same-seed outputs side by side. It does not collect votes in the first phase.

### Result detail

The result header contains:

- exact model and model parameters;
- Agent and harness versions;
- Benchmark release and publication tier;
- Core, Build, and Reproduce;
- coverage, number of attempts, verification state, and publication status.

The body contains:

- a complete generated-game gallery, including failures;
- per-task mean, deviation, and category contribution;
- every included seed and physical `run_id`;
- failed atomic tests with messages and public screenshots;
- wall time, tokens, and cost as independent metrics;
- clean source, playable, license, and evidence links;
- public human-review summaries, separated from machine score;
- publication, configuration, release-lock, source-commit, image-digest, and
  artifact identities.

Superseded or withdrawn entries remain addressable and receive a prominent
status banner linking to the replacement where one exists.

## Version model

The site treats the following versions independently:

- `benchmark_version` defines score comparability.
- `task_version` and task hash identify a task contract.
- result `schema_version` controls JSON parsing.
- `site_build_id` is the Git commit used to build presentation pages.

Release selection must use semantic-version ordering, not filename or
lexicographic ordering. A release page should derive a human-readable diff from
adjacent locks:

- tasks added or removed;
- task major/version/hash changes;
- scoring and aggregation changes;
- run, bridge, and publication protocol changes;
- fixed-seed or attempt policy changes.

The current active task loader is not sufficient for historical game pages.
Versioned pages must resolve tasks from the selected release lock and validate
the matching active or retired task source by content hash.

The generic home page distinguishes “current Benchmark release” from “latest
release with Official results” so a newly tagged release does not silently show
an old leaderboard as current.

## Static data view

Astro builds a read-only site catalog from:

```text
benchmark/releases/*.json
results/index.json
results/publications/*.json
public object references
active and retired versioned task metadata
```

The build validates schemas, publication identities, index-to-publication
links, release compatibility, task hashes, and object existence before
rendering pages. Category views and efficiency summaries are derived from
published runs at build time; they do not create another trusted scoring
contract.

`results/index.json` remains the mutable discovery ledger. Publication
manifests and content-addressed objects remain immutable facts.

## Refresh and deployment flow

Three changes refresh the public site:

### New Benchmark release

1. Merge validated task and protocol changes.
2. Generate and commit the new immutable release lock.
3. Tag the matching Benchmark version.
4. Build the versioned pages.
5. Make the new release visible even if its Official leaderboard is empty.

Only this flow changes `benchmark_version`.

### New or corrected result

1. Complete and score a private run Series.
2. Export clean source and rebuild it without provider credentials.
3. Create playable, deterministic cover, public screenshots, and license
   artifacts.
4. Upload content-addressed objects before publishing metadata.
5. Generate and validate the immutable Publication manifest.
6. Open a PR updating the Publication ledger and `results/index.json`.
7. CI validates schemas, hashes, licenses, object availability, and version
   isolation.
8. After merge, build and deploy a new static site release.

A correction creates a new Publication and marks the old index entry
`superseded`; a withdrawal changes discovery status but does not delete
history.

### Site-only change

Copy, accessibility, styling, and presentation changes rebuild the site with a
new `site_build_id`. They do not create a Benchmark release.

The deployable output is copied to a Git-SHA directory and the trusted site's
`current` pointer changes atomically. The persistent object root is not
replaced. HTML and discovery pages use short caching; content-addressed
playables and objects use long immutable caching.

## Language policy

The first public stage uses one canonical URL per page with an English and
Simplified Chinese presentation. The selected language follows an explicit
`?lang=en|zh` handoff, then a device-local preference, then the browser
language. It is not part of Benchmark identity and never changes a score or
Publication URL.

Public navigation, explanations, score labels, status, empty states, page
titles, descriptions, image alternatives, and ARIA labels must switch
together. Model names, version numbers, task IDs, hashes, filenames, source
code, and verbatim evaluator failures remain unchanged because translating
them would damage auditability. Chinese pages use a CJK-first type stack and
less aggressive letter spacing.

The isolated play origin keeps its own local preference because it cannot read
the trusted site's storage. Links between the two origins pass the language
explicitly. Separate `/zh/` URLs should be introduced only when localized
search indexing or independently shareable Chinese metadata becomes a product
requirement; until then the single canonical URL avoids doubling every
immutable result and showcase route.

## Delivery stages

### Stage 1: comparable public data

- semantic release ordering and a version-aware data layer;
- canonical versioned leaderboard and game routes;
- correct Official/Experimental/status handling;
- enriched result detail with failures, telemetry, review summaries, and
  immutable identity;
- no arbitrary “first playable” selection.

### Stage 2: playable showcase

- deterministic showcase capture in Publisher;
- model-first and game-first output galleries;
- trusted showcase wrapper with on-demand iframe;
- reference/output visual checkpoints and fixed-seed selector;
- optional read-only side-by-side comparison.

### Stage 3: publication operations

- result PR validation against the public object root;
- static build manifest containing `site_build_id`, selected release, and
  publication IDs;
- atomic static deployment and cache policy;
- smoke tests for CSP, iframe isolation, broken objects, superseded banners,
  and cross-version separation.

No backend is introduced in these stages. An API and PostgreSQL become
justified only for public submissions, authentication, hosted voting, review
queues, or asynchronous evaluations. Git publications remain the public source
of truth even then.

## Acceptance criteria

- No page ranks results from different `benchmark_version` values together.
- Every leaderboard score links to an immutable result.
- Every playable links back to a score, source artifact, publication, and
  license.
- Official galleries show the fixed default seed and never cherry-pick the best
  attempt.
- Failed tasks remain visible.
- Missing telemetry is not converted to zero.
- A missing object, invalid hash, unknown schema, or release mismatch fails the
  site build.
- Superseded and withdrawn results remain accessible with correct status.
- Untrusted game code cannot reach the trusted origin's DOM, cookies, storage,
  or network.
- The primary score and methodology remain readable without client-side
  JavaScript; only the interactive player requires it.
