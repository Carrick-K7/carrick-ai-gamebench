# ADR 0001: Repository and production boundaries

- Status: Accepted; amended for Benchmark v0.5
- Date: 2026-07-26
- v0.5 amendment: 2026-08-29
- Decision owners: GameBench maintainers

## Context

GameBench has four tightly coupled public concerns: benchmark definitions,
execution and scoring, validated result publication, and a static public site.
The site consumes Core schemas, release locks, and publication manifests
directly. Splitting these concerns now would require package publishing,
cross-repository version locks, and coordinated CI without creating a useful
security or lifecycle boundary.

Production credentials, host configuration, monitoring, raw Agent runs, and
private review records have different access and retention requirements.
Generated playables also have a different storage and trust model from source
code and small reviewed metadata.

Benchmark v0.5 additionally distinguishes one Agent development submission from
multiple deterministic evaluations of the same frozen source. It makes Build
the primary board, reports Reproduce independently, and treats human review as
optional annotation. Creative evaluation has a different construct and trust
model and must not silently become a third GameBench track.

## Decision

The target is:

| Boundary | System of record |
| --- | --- |
| GameBench tasks, release locks, Core, Evaluator, Publisher, optional Reviewer, public site, public result metadata | Public `Carrick-AI/gamebench` Monorepo |
| Domains, hosts, Caddy/IaC, deployment credentials, monitoring, and production state | Private `carrick-ops` repository |
| Playables, clean source, screenshots, licenses, and evidence artifacts | Content-addressed object storage |
| Raw submissions/evaluations, trajectories, provider responses, complete traces, and private votes | Private run storage |
| Future Creative benchmark identity, releases, methodology, results, and leaderboard | Separate benchmark boundary; location chosen when that project starts |

The public repository keeps these top-level boundaries:

```text
benchmark/  immutable GameBench release inputs and task sources
packages/   Core, Evaluator, and Publisher
apps/       static site and local optional Reviewer
results/    immutable publications and mutable discovery index
infra/      portable examples and deployment interface only
```

The site may import `@carrick/gamebench-core` and read only public benchmark and
result data. It must not import Evaluator or Publisher, inspect `runs/`, or
require provider credentials. Publisher remains beside Evaluator so one commit
can update schemas, snapshot rules, scoring, and release locks atomically. No
npm package is required during the first public phase; users clone a fixed tag.

The trusted site and untrusted playable origins remain separate. Git stores
small reviewed metadata; immutable objects use stable content-addressed keys,
independent of whether the backing store is a filesystem, R2, S3, or MinIO.

## v0.5 benchmark boundary

For each task, one Agent invocation creates one submission and one sealed
`source_snapshot_hash`. Seeds `104729`, `130363`, and `155921` are evaluated in
fresh isolated materializations of that same snapshot. Submission identity,
development usage, and source artifacts are separate from per-seed run identity,
score, timing, and evidence.

Deterministic machine contract evaluation is authoritative. Build is the
primary leaderboard. Reproduce is independently aggregated and reported; it is
not a hidden Build weight or prerequisite. Human review may be stored or
published as optional qualitative annotation, but it cannot affect machine
score, qualification, Build rank, or Reproduce score.

Creative quality, novelty, aesthetics, and fun are not GameBench scoring fields.
A future Creative benchmark must have its own benchmark identity, release lock,
methodology, result index, qualification, and leaderboard. It may share generic
infrastructure but cannot extend `build|reproduce`, GameBench coverage, or a
historical Core aggregate.

## Historical compatibility

v0.1-v0.4 release locks, runs, publications, and URLs remain immutable. Their
three fixed seeds represented three fresh Agent developments, and their
aggregate schemas could include Core. v0.5 adds new schema generations rather
than reinterpreting those records. Historical readers and versioned site views
remain supported.

## GitHub organization migration

The repository currently lives at `Carrick-K7/carrick-ai-gamebench`. After the
`Carrick-AI` organization exists, maintainers will:

1. transfer and rename it to `Carrick-AI/gamebench`;
2. create `maintainers`, `benchmark-reviewers`, and `site-ops` teams;
3. update CODEOWNERS from the current owner fallback to those teams;
4. protect `main` with CI, publication validation, one approving review, no
   force pushes, and no deletion;
5. retain GitHub's redirect from the old repository URL.

Organization creation, membership, billing, and team assignment are account
governance actions and are intentionally not encoded here.

## Publishing and production

Benchmark tags, release locks, and release artifacts must agree exactly.
Publication manifests are append-only; corrections create a new publication
and update `superseded_by` in discovery. A v0.5 Official board accepts only
maintainer-controlled data with one included submission per required task and
all fixed-seed evaluations of each identical snapshot. External candidates
enter Experimental review.

Static builds are identified by Git commit. Public workflow produces an
immutable build artifact; private Ops promotes that exact artifact and changes
the production pointer atomically. Public CI does not own host credentials or
production state.

## Split conditions

- Split GameBench results only when external permissions or update frequency
  materially disrupt core development.
- Split the site only when it gains accounts, online voting, a submission queue,
  an API, or a separate product team.
- Split task data only when assets require LFS/external datasets or an
  independent release cycle.
- Start Creative as a separate benchmark boundary from its first release; do
  not wait for the operational split conditions above because score identity
  and methodology are already distinct.

After any GameBench operational split, this repository remains authoritative for
GameBench release locks, schemas, Official publication definitions, and scoring.
Consumers use a fixed version and do not copy scoring logic. A future Creative
benchmark is authoritative for its own contracts and does not override this
repository's history.

## Consequences

One GameBench commit can reproduce a task, submission/evaluation contract,
score, result, and website view. Production secrets and high-risk untrusted data
stay outside the public source tree. The tradeoff is repository-wide access
control until a concrete operational split occurs.

Separating Creative prevents subjective or model-assisted scoring from changing
GameBench's deterministic machine-contract meaning. Retaining legacy readers
costs maintenance effort but preserves published hashes, URLs, and research
comparability.
