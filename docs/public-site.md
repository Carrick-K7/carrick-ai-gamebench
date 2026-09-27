# Public site

The GameBench site is a read-only static view of release locks, active task contracts, historical publications and the single flat result index shared by Build/Play. It never executes Agents, accepts submissions, stores accounts or reads local `runs/` directories.

## Build / Play presentation

- Build and Play are independent; Play has per-game rankings, not an aggregate.
- A Build row represents a four-task observation. A ranked Play row requires complete two-game coverage and complete Campaign publication.
- Show model, Agent, harness, score-relevant parameters, benchmark version, Build mean, and 4/4 coverage.
- Explain that each task receives one Agent invocation and one seed-`104729` evaluation.
- Do not claim Docker isolation, independent reproduction, hidden tests, or human judging.
- Human comments, when present, are optional and separate from score.
- Never rank different benchmark versions together.

The site reads `results/lite/index.json` and validates each referenced flat `result.json` with Core before rendering. Current records also use shared qualification, including whole-Campaign completeness and same-commit checks. Flat Build v2/v3 records project directly into small display objects; no synthetic Submission, Evaluation, Publication or Core entities are needed in memory or on disk. Pre-flat historical publications retain their own boundary adapter, content identities and URLs.

Build and Play select result-bearing versions independently. Absent or incomplete scores remain absent/unranked, never zero-filled. Cross-Campaign rankings are descriptive rather than paired causal comparisons. Play practice is explicitly unranked and creates no results.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Current release overview and historical playable highlights |
| `/leaderboard` | Latest result-bearing release shortcut |
| `/benchmarks/<version>/leaderboard` | Exact-version ranking |
| `/games` | Current four-task catalog |
| `/benchmarks/<version>/games/<task-id>` | Frozen task prompt, contract, and point allocation |
| `/releases` | Release archive |
| `/methodology` | Plain-language 0.6 workflow and trust boundary |
| `/results/<id>` | Immutable Build result detail, retaining historical identities |
| `/play` | Independent Play overview and result-bearing version selection |
| `/play/<version>/<game>` | Exact-version per-game ranking |
| `/play/practice/<game>` | Unranked human practice on the frozen reference resources |

## Trust boundary

The presentation origin is trusted. Generated games, if public artifacts are added later, must use a separate untrusted origin and sandboxed iframe. Provider credentials, raw trajectories, source workspaces, and private traces are never site inputs.

Accessibility, bilingual English/Chinese content, keyboard navigation, reduced-motion support, semantic tables, and mobile layouts remain required.
