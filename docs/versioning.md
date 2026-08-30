# Versioning

CAGB versions the complete benchmark, its public contracts, and each task
independently.

## Benchmark releases

The root `package.json` version identifies the evaluator, task catalog, scoring
rules, board policy, and browser protocol released together. Presentation-only
site and documentation changes use their Git commit as `site_build_id` and do
not alone require a benchmark release.

Before publishing a release:

1. choose a new semantic benchmark version;
2. run `pnpm build`;
3. generate the intended release-lock schema;
4. run `pnpm check`;
5. commit the append-only `benchmark/releases/<version>.json`;
6. create the matching immutable Git tag `v<version>`.

Release locks are never edited after release. Result contracts carry independent
integer `schema_version` fields. Exact execution is also pinned by release-lock
hash, source Git commit, source snapshot hash where applicable, and evaluator
image digest. The site ranks only equal `benchmark_version` values.

## Release-lock generations

### v1 and v2 history

Release Lock v1 covers the early task catalog and bridge identity. Release Lock
v2 records task identity, Run/Publication protocols, scoring/aggregate schemas,
three attempts per task, and fixed seeds.

For benchmark v0.1-v0.4, `attempts_per_task: 3` means three fresh Agent
development runs per task. Each seed belongs to its own physical development
run. Aggregate schemas may expose Build, Reproduce, and Core. From v0.3, Core
weights Build and Reproduce equally. Those meanings are immutable.

### v3 for benchmark v0.5

Release Lock v3 records the v0.5 topology explicitly:

- `agent_invocations_per_task: 1`;
- `evaluation_seeds: [104729, 130363, 155921]`;
- Submission Manifest v1;
- Run/Evaluation Manifest v3;
- Series Manifest v2;
- Publication Manifest v2;
- Aggregate v3;
- `primary_board: build`.

One invocation creates one sealed submission for a task. Each evaluation seed
runs against a fresh materialization of the identical `source_snapshot_hash`.
The new fields do not reinterpret v2 `attempts_per_task`.

Build is the canonical v0.5 leaderboard. Reproduce remains part of the frozen
catalog but is independently aggregated and reported. v0.5 does not create a
new ranked Core composite. Human review is optional annotation, and Creative is
outside this benchmark identity.

## Benchmark v0.5.0

v0.5.0 is intentionally not score-comparable with v0.1-v0.4 even if task IDs and
content hashes remain unchanged. It changes:

1. execution topology from three Agent developments to one submission plus
   three seed evaluations;
2. identity and publication contracts by separating submission from evaluation;
3. aggregation and coverage reporting;
4. the primary ranking from historical Core to Build;
5. Reproduce from a Core component to an independent report;
6. human review from a prominent benchmark surface to optional annotation.

These changes alter what a score means and how evidence is produced. They
therefore require a new Benchmark release, release-lock schema, result contract,
and version-isolated site presentation even when no task test changes.

## Earlier releases

Benchmark v0.4.0 keeps the v2 task catalog and v0.3 scoring unchanged while
hardening runtime isolation. Submission install, build, preview, and browser
processes receive explicit non-secret environments; browser requests are
limited to the evaluated loopback origin; playables are secret-scanned; and
task-relative paths cannot escape the frozen task package. Task hashes remain
identical to v0.3.0, but results are version-separated because runtime policy
can affect scores.

Benchmark v0.3.0 activates the `.v2` task set, exposes public cases to the Agent,
verifies active run seeds, adopts image-area-relative visual tolerances, defines
deadline snapshots, and changes historical Core aggregation to equal Build and
Reproduce weighting. Unchanged `.v1` sources are retained under
`benchmark/retired/0.2.0/`.

Run Manifest v1/v2, Aggregate v1/v2, Publication v1, and Release Lock v1/v2
remain readable. Historical tags, release locks, publications, and result IDs
are never rewritten or normalized into v0.5 JSON.

## Historical tag audit

`v0.2.0` was not tagged at release time. Repository history identifies commit
`ef3b6dc55afcd557a10813bf0b6148a76c9dd19c` as the atomic 0.2.0 change: its
root/package versions are `0.2.0`, it introduces
`benchmark/releases/0.2.0.json`, and retained v1 task sources resolve that lock
by exact hash. This records the candidate commit but does not create or move a
retroactive tag.

## Task versions

A task ID ends in `.vN`, and `N` equals the task version's major component:

```text
build.2048.v1       version: 1.0.0
build.2048.v2       version: 2.0.0
```

Increment task major when a prompt, score weight, test, fixture, reference
capture, state schema, runtime, or network policy can change a task score.
Retain old task source when an old release must remain executable from the same
branch. Retired directories are excluded from active discovery; tags and
release locks remain authoritative.

A protocol-only change does not require a task-major bump when the task bytes
and per-seed contract are unchanged. It still requires a new Benchmark release
when execution, aggregation, qualification, or ranking meaning changes—as in
v0.5.

Patch task versions are reserved for non-scoring metadata corrections. They
still require a new release lock so every result names one exact catalog.

## Adding games

Use a stable lowercase slug and keep the task self-contained:

```text
benchmark/tasks/
  build/<game-slug>/vN/
    task.yml
    prompt.en.md
    prompt.zh.md
    state.schema.json
    tests/cases.json
  reproduce/<game-slug>/vN/
    ...the same files...
    THIRD_PARTY.yml
    reference/
    references/
```

Within v0.5, tasks have equal weight inside their own report. Adding a Build
task expands Build coverage; adding a Reproduce task expands only Reproduce
coverage. Neither operation creates a combined Core score.

## Creative benchmark boundary

Creative must not be added as a third GameBench track. A future Creative
benchmark receives a separate benchmark name/identity, semantic version,
release-lock ledger, tasks, scoring methodology, result index, qualification
rules, and leaderboard. Shared infrastructure does not imply score or release
compatibility.
