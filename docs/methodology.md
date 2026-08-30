# Methodology

## What CAGB v0.5 measures

Carrick AI GameBench evaluates delivered, playable browser games against public,
machine-checkable contracts rather than judging source patches in isolation.

- **Build** measures specification-to-game delivery. It is the primary v0.5
  leaderboard.
- **Reproduce** measures mechanics, timing, interaction, and visual fidelity to
  a licensed reference. It is reported independently and never contributes to
  Build rank.

The trusted score does not measure creativity, novelty, aesthetics, or fun.
Human playtesting may be attached as an optional qualitative annotation, but it
is not a scoring stage. A future Creative benchmark will define those constructs
under a separate benchmark identity, methodology, release ledger, and board.

## Machine contract evaluation

Every task declares atomic public browser checks totalling 100 points. A
submission must install, build, serve, expose the bridge, and return a valid
initial snapshot. A hard-gate failure produces zero for that seed evaluation.
No LLM or VLM contributes to the trusted score.

Build task budgets:

| Category | Points |
| --- | ---: |
| Build and bridge | 5 |
| Core mechanics | 60 |
| State and edge cases | 20 |
| Real input | 10 |
| Stability | 5 |

Reproduce task budgets:

| Category | Points |
| --- | ---: |
| Build and bridge | 5 |
| Mechanics | 45 |
| Feel and timing | 20 |
| Visual checkpoints | 20 |
| Stability | 10 |

The complete scored manifest and public cases are inspectable. Public tests make
the contract auditable but permit test-specific hardcoding, so Official
publication also requires clean-source reconstruction, evidence validation, and
independent reproduction.

## One development, three seed evaluations

For every task, v0.5 performs exactly one Agent invocation and creates one
submission:

1. prepare one fresh development workspace;
2. invoke the Agent once with the frozen prompt, budget, and network policy;
3. stop the Agent at completion or at the coding deadline;
4. remove evaluator-owned transient files and seal an immutable source snapshot;
5. materialize that same snapshot separately for seeds `104729`, `130363`, and
   `155921`;
6. install, build, serve, and evaluate each materialization in a fresh isolated
   environment.

The source snapshot hash must be identical for all three evaluations. A seed is
an evaluation condition, not another Agent attempt. State written by one seed
evaluation cannot be reused by another. The benchmark reports every seed,
their arithmetic mean, and population standard deviation; it never selects the
best result.

A `submission_id` identifies the one frozen task delivery. Each physical seed
evaluation has its own `run_id`, evidence, score, timing, and evaluation input
fingerprint linked back to that submission. Development usage and cost belong
to the submission and are counted once, not once per seed.

A development timeout is a snapshot boundary: the Agent process tree is stopped
and the delivered workspace is sealed. A completed or timed-out submission may
be evaluated. Preparation or Agent errors remain in audit history but cannot
qualify as an Official submission. An evaluation error remains visible and
cannot fill an Official seed cell.

## Boards and aggregation

### Build primary leaderboard

A Build task score is the mean of its three seed evaluations. The Build board is
the macro mean of all required Build task scores, with every Build task weighted
equally. A Build leaderboard score is omitted until all required Build tasks and
all required seed evaluations are present.

Build is the only canonical v0.5 ranking. Reproduce scores, human annotations,
wall time, token usage, and cost cannot be used as hidden weights or tie-breaks.

### Reproduce independent report

A Reproduce task uses the same one-submission, three-evaluation protocol. The
Reproduce score is the macro mean of all required Reproduce task scores. It has
its own coverage, evidence, reliability statistics, and qualification state.
It is shown on an independent report and does not create or modify a Build
leaderboard score.

v0.5 does not publish a new Core score. Any `core` fields retained by compatible
readers are legacy data surfaces and must not be presented as v0.5 ranking
metrics.

## Browser protocol

The evaluator fixes Chromium, fonts through the evaluator image, a 1280×720
viewport, and device scale factor 1. For each seed materialization it:

1. verifies the frozen source snapshot hash;
2. installs from the frozen pnpm lockfile;
3. builds the submission;
4. starts preview on a dynamically allocated loopback port;
5. verifies bridge version 1 and validates the first snapshot;
6. executes real keyboard/pointer operations and controlled bridge actions;
7. validates snapshots against the task JSON Schema;
8. captures traces, failure screenshots, and declared visual checkpoints.

Every ordinary bridge reset receives that evaluation's seed. Declared reference
fixtures may use an explicit seed. Every v2 game reports the applied integer in
the top-level snapshot `seed`, allowing the evaluator to verify that each
condition was actually applied.

Reproduce screenshots use deterministic scenarios and explicit image-area-
relative tolerances. Thresholds are calibrated against the reference,
blank pages, and deliberately deficient outputs.

## Publication tiers

- **Experimental** may be partial, missing seed evaluations, locally attested,
  or awaiting independent verification. It is evidence, not an Official rank.
- **Official Build** requires one included submission for every required Build
  task, all three fixed seed evaluations of each exact source snapshot, a clean
  benchmark checkout, clean-source reproduction, digest-pinned evaluation,
  evidence verification, and applicable network attestation.
- **Official Reproduce** applies the same requirements to the Reproduce task
  set and is reported separately. It is not required to produce a Build score.

Failed and excluded submissions and evaluations remain in immutable audit
history. Coverage is always reported so partial data cannot appear complete.

## Optional human annotation

Blinded pairwise playtesting may record controls, clarity, polish, visual
quality, and game feel. Public summaries may report sample counts, outcomes,
and issue tags. They are optional qualitative annotations only: they do not
change machine scores, qualification, Build rank, Reproduce score, or
publication trust.

The public site does not collect votes. Existing local reviewer and historical
review records remain available for research and v0.1-v0.4 compatibility, but
human review is not a required v0.5 workflow stage.

## Historical semantics

v0.1-v0.4 results are not recomputed under this methodology. Their release
locks and manifests retain their original meanings:

- each fixed seed represented a fresh Agent development run;
- aggregate schemas could expose Build, Reproduce, and a combined Core score;
- from v0.3, Core weighted Build and Reproduce equally.

Versioned pages must explain and render those historical contracts as released.
No v0.5 result is ranked with an earlier benchmark version.

## Limitations

Public tests allow test-specific hardcoding. Reproduce tasks cannot eliminate
pretraining or prior-source exposure. Deterministic contract compliance also
does not establish creative quality or player preference. These limitations
are reported directly rather than hidden inside a composite score.
