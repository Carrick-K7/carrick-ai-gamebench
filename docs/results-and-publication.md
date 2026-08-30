# Results and publication

## v0.5 identity hierarchy

v0.5 distinguishes the Agent's development from deterministic evaluation:

- `series_id` identifies one benchmark batch.
- `submission_id` identifies one task's single Agent invocation and sealed
  source snapshot.
- `configuration_id` identifies the exact Agent/model/harness configuration,
  prompt language, execution profile, and relevant environment.
- `development_input_fingerprint` hashes the development inputs without an
  evaluation seed.
- `source_snapshot_hash` binds all seed evaluations to identical delivered
  bytes.
- `run_id` identifies one physical seed evaluation and is never reused.
- the evaluation `input_fingerprint` adds the submission, seed, task contract,
  and evaluator environment.
- `artifact_id` hashes file bytes or a canonical directory manifest.
- `publication_id` hashes the complete canonical publication payload.

Canonical JSON follows RFC 8785 for GameBench JSON values, and public content
IDs use SHA-256. Equal fingerprints are reruns, never overwrites.

For v0.1-v0.4, Run Manifest v1/v2 retains its original meaning: a physical run
combined one fresh Agent development and one seed. Historical readers must not
synthesize a shared submission across those runs.

## One submission, three evaluations

For each v0.5 task:

1. the runner invokes the Agent once;
2. the coding deadline stops the complete Agent process tree;
3. evaluator transients are removed and the workspace is sealed;
4. the source snapshot receives one stable hash;
5. seeds `104729`, `130363`, and `155921` each receive a freshly materialized
   copy of that same snapshot;
6. each fresh environment installs, builds, serves, and evaluates independently.

A submission ending in `completed` or `timeout` can be evaluated. An
`agent-error` or `preparation-error` remains audit-visible but cannot qualify as
an Official submission. An `evaluation-error` remains visible but cannot fill a
required seed cell.

Development token usage, cost, and time are attached to the submission and
counted once. Evaluation time, score, screenshots, trace evidence, and exit
state are attached to each seed run. The publisher and site must not describe
three seed runs as three Agent attempts.

## Aggregation and qualification

Each task reports every seed score, arithmetic mean, and population standard
deviation. Build macro-averages complete Build tasks and is the primary v0.5
leaderboard. Reproduce macro-averages complete Reproduce tasks and is published
as an independent report. Reproduce never changes or breaks a Build score, and
v0.5 does not introduce a ranked Core composite.

An Official Build publication requires:

- exactly one included submission for every required Build task;
- exactly one included evaluation for every fixed seed of each submission;
- the same `source_snapshot_hash` across those evaluations;
- a clean benchmark checkout and known source commit;
- clean-source reconstruction and secret scanning;
- score/evidence reproduction in a digest-pinned evaluator image;
- applicable operator network attestation and license records.

Official Reproduce applies the same conditions to the Reproduce task set and is
reported separately. Experimental publication requires at least one included,
scored evaluation and clearly reports incomplete task or seed coverage.

Excluded submissions, failed evaluations, and reruns remain immutable audit
history. The series explicitly records which submissions and evaluations are
included.

## Storage boundary

Git is authoritative for release locks, `results/index.json`, and immutable
publication manifests. A content-addressed object store holds larger artifacts:

```text
objects/sha256/<prefix>/<digest>/<file>
play/<playable-directory-digest>/index.html
```

Raw run logs, model/provider events, trajectories, environment files, private
votes, and complete traces are audit-private. The publisher exports allowlisted
source, rejects unsafe paths and credentials, rebuilds without provider
credentials, and archives artifacts deterministically.

A clean rebuild may create one fixed-state `<task-id>-showcase.png`. The release
presentation seed chooses the default cover; it does not choose a winning score.
All included seed evaluations stay accessible, and failure screenshots are
never gallery covers.

## Workflow

```bash
# One invocation for this task; v0.5 evaluates the sealed submission at all
# required seeds in fresh environments.
pnpm cagb run --task build.2048.v2 \
  --agent-command './agent' --agent-id agent --model model \
  --official --series 01K...

# Publish metadata to Git and artifacts to the object root.
pnpm cagb publish --series runs/0.5.0/01K... \
  --tier experimental \
  --board build \
  --objects .gamebench \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication --results results --objects .gamebench
```

Use the CLI rather than editing canonical publication JSON by hand. Objects
must exist before metadata is proposed.

## Optional human annotation

Human playtesting may be attached as an optional qualitative annotation with
methodology, sample counts, outcomes, and tags. It does not participate in
machine score identity, aggregation, Official eligibility, Build ranking, or
Reproduce reporting. Missing human annotation means “not reported,” never zero.
Historical v0.1-v0.4 review records remain readable under their original
publication contracts.

## Corrections and history

Published manifests are immutable. A correction creates a new publication and
updates discovery metadata with `superseded_by`; a withdrawal removes an entry
from active discovery without deleting its immutable URL.

Release locks, schema readers, and result pages for v0.1-v0.4 remain available.
Their three fresh development runs and historical Core fields keep their
original meaning. They are not recomputed, relabeled, or ranked with v0.5.
