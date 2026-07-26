# ADR 0001: Repository and production boundaries

- Status: Accepted
- Date: 2026-07-26
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

## Decision

The target is:

| Boundary | System of record |
| --- | --- |
| Benchmark tasks, release locks, Core, Evaluator, Publisher, Reviewer, public site, public result metadata | Public `Carrick-AI/gamebench` Monorepo |
| Domains, hosts, Caddy/IaC, deployment credentials, monitoring, and production state | Private `carrick-ops` repository |
| Playables, clean source, screenshots, and license artifacts | Content-addressed object storage |
| Raw runs, trajectories, provider responses, complete traces, and private votes | Private run storage |

The public repository keeps the current top-level boundaries:

```text
benchmark/  immutable release inputs and task sources
packages/   Core, Evaluator, and Publisher
apps/       static site and local Reviewer
results/    immutable publications and mutable discovery index
infra/      portable examples and deployment interface only
```

The site may import `@carrick/gamebench-core` and read only public benchmark
and result data. It must not import Evaluator or Publisher, inspect `runs/`, or
require provider credentials. Publisher remains beside Evaluator so a single
commit can update schemas, rebuild rules, scoring, and release locks
atomically. No npm package is published during the first public phase; users
clone a fixed Git tag.

The trusted site and untrusted playable origins remain separate. Git stores
small reviewed metadata; immutable objects use stable content-addressed keys,
independent of whether the backing store is a filesystem, R2, S3, or MinIO.

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
governance actions and are intentionally not encoded in this repository.

## Publishing and production

Benchmark tags, release locks, and release artifacts must agree exactly.
Publication manifests are append-only; corrections create a new publication
and update `superseded_by` in the discovery index. Official results are
accepted only from a maintainer-controlled, complete three-seed execution.
External candidates enter Experimental review.

Static builds are identified by Git commit. The public workflow produces an
immutable build artifact, while the private Ops process promotes that exact
artifact and atomically changes the production pointer. Public CI does not own
host credentials or production state.

## Split conditions

- Split results only when external result permissions or update frequency
  materially disrupt core development.
- Split the site only when it gains accounts, online voting, a submission
  queue, an API, or a separate product team.
- Split task data only when assets require LFS/external datasets or an
  independent release cycle.

After any split, this repository remains authoritative for release locks,
schemas, Official publication definitions, and scoring. Other repositories
consume a fixed version and do not copy scoring logic.

## Consequences

One commit can reproduce a task, score, result contract, and website view.
There is no cross-repository package-release choreography in the early phase.
Production secrets and high-risk untrusted data stay outside the public source
tree. The tradeoff is that access control is repository-wide until a concrete
split condition occurs.
