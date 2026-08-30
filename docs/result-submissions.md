# Result submission policy

GameBench accepts public result candidates as generated, reviewable evidence,
not as unverified leaderboard claims.

## Submission classes

- **Experimental** may be partial, missing tasks or seed evaluations, locally
  attested, or awaiting independent verification. Every limitation is explicit.
- **Official candidate** is an internal execution profile, not a public tier.
  Under v0.5 it contains one Agent invocation and one sealed submission per
  required task, then all fixed-seed evaluations of each exact snapshot.
- **Official Build** is published only after the complete Build board is
  independently reproduced and verified.
- **Official Reproduce** applies the same trust requirements to the Reproduce
  task set and is reported separately. It cannot change Build rank.

External submissions request Experimental publication. Maintainers may select a
candidate configuration for a separate controlled Official execution; an
external run is not relabeled by assertion.

## v0.5 execution requirements

For each included task, a candidate must preserve:

1. exactly one included `submission_id` from one Agent invocation;
2. the sealed `source_snapshot_hash` produced at the coding boundary;
3. one evaluation of that submission for each included seed;
4. a fresh materialization and isolated evaluator environment for every seed;
5. development usage attached once to the submission;
6. per-seed score, evidence, timing, exit state, and `run_id`.

An Official board requires all three release seeds (`104729`, `130363`, and
`155921`) for every task required by that board. All evaluations of one task
must name the same submission and snapshot. Cherry-picking the best seed,
substituting another source tree, or invoking the Agent once per seed is not a
v0.5 Official execution.

## Required public contents

A result PR contains:

1. one new immutable file under `results/publications/`;
2. the matching append-only discovery entry in `results/index.json`;
3. content-addressed references for clean source, playable output, public
   screenshots, evidence, and applicable third-party licenses;
4. no raw workspace, trajectory, provider response, credential, private vote,
   or complete trace.

Objects must be uploaded before the manifest is proposed. The publication keeps
the exact Benchmark release and lock hash, task hashes, model parameters,
Agent/harness identity, submission and evaluation identities, source snapshot,
seeds, exit states, verification, and missing telemetry visible.

Use the CLI rather than editing publication JSON:

```bash
pnpm cagb publish \
  --series runs/<benchmark-version>/<series-id> \
  --tier experimental \
  --board build \
  --objects <object-root> \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication \
  --results results \
  --objects <object-root>
```

## Ranking and annotation rules

- Build is the v0.5 primary leaderboard. Only complete, verified Build machine
  contract results enter it.
- Reproduce is independently aggregated and displayed. It is not a Build
  prerequisite, hidden weight, or tie-break.
- v0.5 does not publish a new Core ranking.
- Human playtesting is optional qualitative annotation only. It cannot change
  machine score, tier, qualification, Build rank, or Reproduce score.
- Creative quality is outside this benchmark. Future Creative submissions will
  use a separate benchmark identity and policy.

## Review rules

- Existing Publication JSON is never edited or deleted.
- A correction creates a new publication and marks the old index entry
  `superseded`.
- A withdrawn result remains addressable with a visible status.
- Scores from different Benchmark versions are never ranked together.
- License ambiguity, missing objects, secret-scan failures, inconsistent
  hashes, source-snapshot mismatch, or misleading configuration metadata block
  publication.
- Maintainers may reproduce even an Experimental candidate before acceptance.

## Historical submissions

v0.1-v0.4 publications remain valid under their own release locks. Their fixed
seeds represented separate fresh Agent developments, and their aggregate
schemas could include Core. Do not retrofit v0.5 submission/evaluation parentage
onto those runs, rewrite their manifests, or reassess their Official status
under v0.5.

See [results and publication](results-and-publication.md) for identity and
storage details and [methodology](methodology.md) for the scoring contract.
