# ADR 0002: Campaign and run namespace

- Status: Accepted and implemented
- Date: 2026-08-30
- Decision owners: GameBench maintainers

## Context

GameBench needs to execute several models under one preregistered comparison without recreating the scattered historical pattern of directories named after models, providers, profiles, retries, or benchmark nicknames. The layout must also survive new benchmark versions, task counts, seed protocols, result schemas, and Agent harnesses without moving historical data.

A directory layout alone cannot protect scientific identity. Model labels supplied separately from the command can drift, repeated complete runs can be cherry-picked, and a mutable campaign ledger can become a second source of truth.

## Decision

GameBench uses exactly three durable namespaces:

```text
benchmark/campaigns/<benchmark-version>/<campaign-id>.json
runs/<benchmark-version>/<series-id>/
results/lite/<benchmark-version>/<series-id>.json
```

The campaign plan is committed before execution. It is single-release, strict-schema, and contains preregistered cells, execution order, primary endpoint, provider/model/Agent configuration, tracked adapter identity, and one preallocated `series_id` per cell.

Raw run paths contain only benchmark version and series ULID. Model, provider, harness, campaign, status, profile, seed, and retry labels are manifest properties and never path segments.

Published results remain flat and immutable. A result binds its campaign ID, cell ID, plan hash, and canonical execution-spec hash. Campaign views are derived from the campaign plan and flat result index; no second campaign-results ledger is created.

A campaign is single-shot. A planned series directory is created exclusively and never reused. Development is never retried. Typed evaluation infrastructure retries remain allowed only against identical frozen source inside the same series. Repeating or correcting a study requires a new campaign ID and new preallocated series IDs.

Official campaign publication validates all cells and updates the flat result index once under an exclusive lock. It does not introduce campaign scoring or a campaign publication format.

The complete normative rules are in `docs/campaign-architecture.md`.

## Rejected alternatives

### Nest runs by campaign/provider/model

Rejected because descriptive names are mutable, collision-prone, path-injection-prone, and force reorganization when aliases or harnesses change.

### Add a mutable `results/campaigns/` binding ledger

Rejected because campaign membership is already fixed by the preregistered plan and result bindings. A second ledger duplicates truth and creates supersession and concurrent-update semantics.

### Generate a fresh series ID at launch and permit same-cell retries

Rejected because hidden repeated complete runs allow outcome-based selection. Preallocation plus exclusive directory creation provides a simpler one-shot invariant.

### Publish the raw command

Rejected because commands may contain host paths or credentials and still do not prove which provider-side weights executed. GameBench instead hashes a canonical secret-free execution specification derived and executed by the trusted runner.

### Generalize all 0.6 protocol literals immediately

Rejected as unnecessary for namespace stability. Future releases may introduce new release/result schema readers while retaining the same outer paths and immutable historical files.

## Consequences

- The four-model Pi comparison requires a tracked Pi adapter and a committed campaign plan before any Official call.
- A failed campaign cannot silently substitute another sample; repeating it is visible as a new committed plan.
- Raw evidence can be cleaned without invalidating public results.
- Version upgrades add new version directories but never rename old data.
- The runner needs campaign-plan schemas, plan-derived Official invocation, phase markers, exclusive series creation, and batch publication before the first campaign executes.
- The design remains maintainer-operated and does not claim cryptographic attestation of proprietary provider model aliases.

## Change rule

Changing these three canonical namespaces or moving an entity across their identity boundaries requires a superseding ADR, explicit migration analysis, and maintainer approval. New manifest fields or version-specific evidence subtrees do not require a namespace change.
