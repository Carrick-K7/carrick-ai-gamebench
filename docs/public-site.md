# Public site

The GameBench site is a read-only static view of release locks, active task contracts, historical result publications, and the lightweight 0.6 result index. It never executes Agents, accepts submissions, stores accounts, or reads local `runs/` directories.

## 0.6 presentation

- Build is the only current leaderboard.
- Every row represents one complete four-task canonical run.
- Show model, Agent, harness, score-relevant parameters, benchmark version, Build mean, and 4/4 coverage.
- Explain that each task receives one Agent invocation and one seed-`104729` evaluation.
- Do not claim Docker isolation, independent reproduction, hidden tests, or human judging.
- Human comments, when present, are optional and separate from score.
- Never rank different benchmark versions together.

The site reads `results/lite/index.json` and validates each referenced flat `result.json` with the core schema before rendering. Historical publication formats may be normalized at the view boundary, but 0.6 does not create legacy Submission, Evaluation, Verification, or Core records on disk.

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
| `/results/<id>` | Immutable result detail |

## Trust boundary

The presentation origin is trusted. Generated games, if public artifacts are added later, must use a separate untrusted origin and sandboxed iframe. Provider credentials, raw trajectories, source workspaces, and private traces are never site inputs.

Accessibility, bilingual English/Chinese content, keyboard navigation, reduced-motion support, semantic tables, and mobile layouts remain required.
