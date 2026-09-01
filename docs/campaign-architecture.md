# Campaign, run, and publication architecture

Status: **Accepted and enforced.**

Applies to GameBench 0.6 and later releases.

This document freezes the filesystem vocabulary and the experiment boundary. Changing a canonical path, identity rule, or campaign lifecycle requires a new ADR, a migration plan, and explicit maintainer approval. Display wording and non-authoritative local diagnostics do not.

## 1. First principles

The architecture follows six requirements:

1. **A benchmark release defines the instrument.** Tasks, seeds, scoring, invocation count, and evaluation protocol belong to the release lock.
2. **A campaign defines the experiment before execution.** Models, providers, Agent harness, parameters, order, and primary endpoint are preregistered and committed before an Official run.
3. **A series is one immutable observation.** It receives one `series_id`; development is never retried. Typed evaluation-infrastructure retries may only reuse the same frozen source within that series.
4. **Paths contain stable coordinates, not descriptive properties.** Model, provider, harness, profile, effort, campaign title, and status never become run-directory segments.
5. **Raw evidence and public results have different lifecycles.** Raw evidence is local and removable; published results are flat, reviewed, and immutable.
6. **The system is auditable, not magically trustless.** GameBench Official remains maintainer-operated. A tracked plan and a trusted runner bind declared configuration to execution; they do not prove which proprietary model weights a provider served.

The resulting rule is:

> Path = low-cardinality coordinate. Manifest = high-cardinality property.

## 2. The only canonical trees

### 2.1 Tracked benchmark program and campaign plans

```text
benchmark/
  releases/<benchmark-version>.json
  tasks/...
  campaigns/
    <benchmark-version>/
      <campaign-id>.json
```

A campaign plan is part of the benchmark program for one experiment. It is committed before execution and is never edited after execution begins. A changed plan receives a new `campaign_id`.

### 2.2 Untracked raw runs

```text
runs/
  <benchmark-version>/
    <series-id>/
      .series.json
      result.json                 # only after a complete series
      benchmark-error.json        # only after an aborted series
      tasks/
        <task-id>/
          source.tar.zst
          source.sha256
          prompt.md
          agent.json
          agent.log
          agent.stderr.log
          score.json
          tests.json
          MANIFEST.sha256
          artifacts/
```

This is the only raw-run namespace. There is no campaign, provider, model, harness, profile, seed, `latest`, `retest`, or `official` directory level.

The CLI derives the run root from the loaded release: `runs/<release.benchmark_version>`. Official and local CLI execution cannot override it. Programmatic tests may call lower-level APIs with a temporary root, but the user-facing CLI never writes raw runs elsewhere.

### 2.3 Tracked public results

```text
results/
  lite/
    index.json
    <benchmark-version>/
      <series-id>.json
```

Publication remains one immutable flat result per series. Campaigns do not own, wrap, copy, or re-score results. Campaign views are derived from the flat index, the referenced results, and the tracked campaign plan.

No `results/campaigns/` ledger is introduced. It would duplicate campaign membership and create a second mutable truth.

## 3. Identities and bindings

| Entity | Stable identity | Authority |
| --- | --- | --- |
| Release | `benchmark_version` + `release_hash` | release lock |
| Campaign | `benchmark_version` + `campaign_id` + canonical plan hash | campaign plan |
| Campaign cell | campaign identity + `cell_id` | campaign plan |
| Series | `benchmark_version` + `series_id` | result |
| Task delivery | `task_id` + `task_hash` + `source_hash` | result + evidence manifest |
| Invocation | canonical execution-spec hash | campaign plan + result |

A path helps locate an entity but never substitutes for these bindings.

### 3.1 Preallocated series IDs

Every campaign cell receives its `series_id` in the committed plan before execution. This provides a simple single-shot rule:

- launching the same cell twice targets the same directory and fails before Agent invocation;
- a complete low score cannot be silently replaced by a second sample under the same campaign;
- an aborted campaign is not resumed or repaired by another development invocation;
- repeating the study requires a new campaign plan, new campaign ID, and new series IDs.

This is intentionally stricter than a retry ledger and requires less mutable state.

### 3.2 Execution attestation boundary

Official campaign execution does not accept independent `--model`, `--provider`, `--harness`, or free-form `--agent-command` labels. It accepts a campaign plan and cell ID, then derives both the declared configuration and the invocation from that cell.

Each cell contains a secret-free canonical execution specification:

- Agent ID and version;
- tracked adapter path and adapter content hash;
- provider and model identifiers;
- model parameters such as thinking level;
- prompt language;
- isolation flags such as no session, no context files, no extensions, and no skills.

The adapter must be a repository-tracked file. Host paths, credentials, bearer tokens, and API keys are forbidden in the plan and result. The runner hashes the canonical execution specification and records that digest in `result.json`.

This is a **trusted-runner attestation**: it proves what the canonical runner was instructed to execute and makes label/adapter drift reviewable. It does not cryptographically attest provider-side aliases or proprietary weights.

## 4. Campaign plan

A campaign plan is strict, versioned JSON. Its minimal shape is:

```json
{
  "schema_version": 1,
  "campaign_id": "pi-system-baseline-2026-08-30",
  "benchmark_version": "0.6.0",
  "release_hash": "sha256:...",
  "comparison": {
    "unit": "system",
    "primary_endpoint": "build.score",
    "comparability": "within-release-only",
    "vary": ["provider", "model"],
    "order_policy": "preregistered"
  },
  "cells": [
    {
      "cell_id": "gpt-5.6-sol",
      "series_id": "<ULID>",
      "agent": { "id": "pi", "version": "0.84.3" },
      "adapter": { "path": "tools/agents/pi-gamebench.sh", "hash": "sha256:..." },
      "provider": "openai-codex",
      "model": "gpt-5.6-sol",
      "parameters": { "thinking": "medium" },
      "prompt_language": "en",
      "isolation": {
        "session": false,
        "context_files": false,
        "extensions": false,
        "skills": false
      }
    }
  ]
}
```

The plan hash is SHA-256 over canonical JSON; it is not stored inside the plan, avoiding a self-hash. `release_hash` is deliberately retained as an assertion that the plan was authored for the exact instrument, even though it can be recomputed.

### 4.1 Comparison semantics

The planned four-model campaign is a **system comparison**, not a pure causal comparison of model weights. Provider transport and model differ across at least one cell. The primary endpoint is the release-defined Build score. Per-task and capability scores are descriptive secondary outcomes and cannot replace the preregistered primary endpoint.

Execution order is explicitly fixed before results exist. It is a preregistered order, not a claim of a reproducible randomization algorithm. The published interpretation remains one observed canonical run per system.

### 4.2 Single-system measurement

A later model may be measured without mutating or rerunning an already published Campaign. Schema v1 represents this as exactly one cell with `comparison.vary: []`. The historical `comparison` property name is retained so existing plan hashes and published bindings remain immutable. A one-cell Campaign is an **Official measurement**, not an internally controlled comparison: it may appear on the flat same-release leaderboard, but cross-Campaign differences include time, provider, and harness-environment effects and must not be described as causal model deltas.

An empty `vary` set is invalid for two or more cells, and a non-empty `vary` set is invalid for a one-cell Campaign. All other preregistration, single-shot, result-binding, and atomic-publication rules are unchanged.

## 5. Series state machine

```text
planned (only in campaign plan)
  └─► prepared ─► running ─► complete
                         └─► aborted
```

`.series.json` is local recovery metadata and contains at least:

- schema version;
- benchmark version and series ID;
- campaign ID, plan hash, and cell ID when applicable;
- status;
- timestamps;
- current task ID when running;
- terminal error summary when aborted.

Rules:

1. The runner creates the exact preallocated series directory exclusively; an existing path is a hard failure.
2. `complete` requires every release-required task and evaluation.
3. Agent development is never retried.
4. Typed infrastructure retries occur only inside the same task against identical frozen source and remain visible in evidence.
5. A process crash leaves a non-complete directory. It is inspectable but never resumable or publishable.
6. `result.json` is written only after the complete series has been assembled and validated.
7. Cleanup treats a valid complete `result.json` as authoritative over a stale phase marker and never scans outside `runs/`.

No per-cell lock is required: exclusive creation of the preallocated series directory is the concurrency primitive.

## 6. Campaign execution and publication

The Official sequence is:

1. Commit the release, tracked adapter, and campaign plan.
2. Run `pnpm check` and `pnpm cagb doctor` on that clean commit.
3. Execute all cells in the preregistered order. All results must record the same Git commit, release hash, and plan hash.
4. Validate the complete local campaign against its plan.
5. Publish the campaign as a **batch operation** while preserving individual flat result files.
6. Commit the result files and one updated flat index.

Batch publication acquires one exclusive index lock, re-reads the index after lock acquisition, validates every cell, copies all missing result files, and atomically renames one fully updated index. Multiple completed Campaigns may be supplied as repeated `--id` arguments and are validated and published in the same lock transaction; this prevents one Campaign's publication files from making the tree dirty before the next is validated. An unindexed result file left by an interrupted prior attempt is an orphan and may be removed only after its bytes are compared with the planned source result. An indexed missing result is a hard integrity failure, never auto-repaired.

Direct single-series publication rejects campaign-affiliated results; even a one-cell measurement passes through Campaign batch publication so the same completeness and atomic-index path applies uniformly.

## 7. Machine-enforceable invariants

1. `benchmark_version` and `release_hash` match the loaded release.
2. Campaign ID and cell ID are normalized lowercase NFC slugs matching `^[a-z0-9][a-z0-9._-]*$` before any path operation.
3. Campaign plans are single-release, strict-schema files; cell IDs and preallocated series IDs are unique.
4. Every tracked adapter exists in Git and its content hash matches the plan.
5. The plan contains no credential-like values, absolute host paths, or escaping relative paths.
6. A campaign result's series ID, configuration, prompt language, plan hash, and execution-spec hash match exactly one planned cell.
7. A one-cell Official measurement has `vary: []`; a multi-cell comparison declares at least one varying property. Multi-cell Campaigns share every execution property outside that set, and every declared varying property differs in at least two cells.
8. Every campaign result records the same clean Git commit and exact release hash.
9. A preallocated series directory is created once and never reused; no development retry exists.
10. A published campaign has exactly one complete Official result per planned cell and no extra cell.
11. `(benchmark_version, series_id)` remains globally unique and published result paths are immutable.
12. Public index updates are lock-serialized, revalidated after lock acquisition, and committed by one atomic rename.

## 8. Future benchmark versions

The outer namespace is stable even when methodology changes:

- a new benchmark release writes `benchmark/releases/<new-version>.json`;
- its plans live under `benchmark/campaigns/<new-version>/`;
- raw series live under `runs/<new-version>/<series-id>/`;
- publications live under `results/lite/<new-version>/<series-id>.json`.

Task counts, seed counts, score aggregation, invocation count, and task-evidence substructure are defined by that release and result schema. They are not encoded in the outer path. A future multi-seed release may add version-specific directories below `tasks/<task-id>/` without moving any series.

Result schema evolution is independent of benchmark version. Readers dispatch on `schema_version`; the flat result index and `(benchmark_version, series_id)` identity remain stable. Existing result files are never rewritten into a newer schema.

A later campaign that repeats the same systems is a new preregistered experiment with a new campaign ID and series IDs. Cross-release scores are not declared directly comparable. There is no `latest` pointer or campaign supersession mutation.

Current 0.6 literals—four tasks, seed `104729`, one Agent invocation—remain valid for the 0.6 reader. They need not be prematurely generalized merely to preserve this filesystem architecture; a future release introduces an explicit new release/result schema where necessary.

## 9. Non-goals

- no verifier, Docker evaluator, Reproduce board, database, queue, scheduler, or service;
- no campaign-level score or alternative leaderboard;
- no hidden claim that provider model aliases identify immutable weights;
- no automatic cross-version score comparison;
- no model/provider/harness directory tree;
- no mutable `latest` symlink;
- no migration or renaming of historical raw runs.

## 10. Change policy

The canonical directories and entity boundaries in sections 2 and 3 are frozen. A proposed change must answer:

1. Which first-principles requirement is currently impossible to satisfy?
2. Why can the change not be represented as a new manifest/schema field?
3. How are all existing releases and published series located without moving them?
4. What new invariant and regression test prevent ambiguity?

If those questions do not have concrete answers, the layout does not change.
