# Methodology

## What CAGB measures

Carrick AI GameBench evaluates delivered, playable browser games rather than
source patches in isolation.

- Build measures requirement-to-game delivery.
- Reproduce measures mechanics, timing, interaction, and visual fidelity to a
  licensed reference.

The benchmark borrows containerized execution and per-instance logs from
[SWE-bench](https://www.swebench.com/SWE-bench/guides/evaluation/), cumulative
stages from [CyberGym-E2E](https://www.cybergym.io/cybergym-e2e/), hashed audit
bundles from [ExploitBench](https://github.com/exploitbench/exploitbench), and
browser-delivered application evaluation from
[WebGameBench](https://arxiv.org/abs/2605.17637).

## Machine evaluation

Every task declares atomic public tests totalling 100 points. A build/serve/
bridge failure is a hard gate and produces a zero for the task.

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

## Leaderboards and repeats

- Build is the macro mean of all six Build tasks.
- Reproduce is the macro mean of both Reproduce tasks.
- Core gives Build and Reproduce equal 50% weight by averaging the two track
  scores. Tasks remain equally weighted within their own track.

A score is omitted until all tasks required by that board are present. The
aggregate output always reports coverage so a partial run cannot appear to be
a complete leaderboard entry.

Official candidates use three fresh attempts with seeds `104729`, `130363`,
and `155921`. The benchmark reports the task mean and population standard
deviation; it never selects the best attempt. Agent, model, harness, prompt
language, time, tokens, and cost are recorded independently. This follows the
agent-configuration and repeated-run distinction used by
[Artificial Analysis](https://artificialanalysis.ai/methodology/coding-agents-benchmarking).

An Official publication contains exactly one included run for every
release-task and fixed-seed cell. Failed and retried executions remain in the
series but are never overwritten; the series explicitly records which run is
included in aggregation.

Each ordinary bridge reset receives the active run seed. A small number of
declared deterministic reference cases may override it with an explicit seed.
Every v2 game must report the applied integer in the top-level snapshot
`seed`, so the evaluator can verify that the three runs are genuinely distinct
inputs rather than metadata-only repeats.

## Browser protocol

The evaluator fixes Chromium, fonts through the evaluator image, a 1280×720
viewport, and device scale factor 1. It:

1. installs from a frozen pnpm lockfile;
2. builds the submission;
3. starts the preview server on a dynamically allocated loopback port;
4. verifies bridge version 1 and validates the first snapshot;
5. executes real keyboard/pointer operations and controlled bridge actions;
6. validates snapshots against the task JSON Schema;
7. captures traces, failure screenshots, and declared visual checkpoints.

Reproduce screenshots use deterministic scenarios and explicit pixel
tolerances normalized by image area. Thresholds are calibrated against the
reference implementation, blank pages, and deliberately deficient outputs.
No LLM or VLM contributes to the trusted machine score.

## Human playtesting

The local reviewer compares two candidates only when task ID, task version, and
prompt language match. Candidate identity and machine score remain hidden.
Reviewers can choose A, B, tie, or both bad and attach reason tags. Votes are
exported as JSONL with candidate hashes and randomized left-side assignment.

Human votes are not added to the machine score. A future hosted Arena can reuse
the same records for Bradley–Terry/Elo aggregation and confidence intervals,
following the pairwise, playable-output approach of
[Code Arena](https://arena.ai/blog/code-arena/).

The public site does not collect votes. It publishes only aggregate review
summaries with opaque artifact hashes, sample counts, outcomes, and issue tags.

## Publication tiers

- Experimental accepts partial coverage and may be unverified. It is useful
  evidence but never appears in the Official leaderboard.
- Official requires full release coverage, a clean benchmark checkout,
  per-run evidence validation, clean-source reconstruction, a rebuild and
  score reproduction in a digest-pinned evaluator image, and operator network
  attestation.

The coding deadline is a snapshot boundary, not an automatic zero: when the
budget expires, the runner terminates the Agent process tree and evaluates the
workspace as delivered. `completed` and `timeout` snapshots may be included in
Official aggregation. `agent-error` and `evaluation-error` runs remain in the
audit history but cannot be selected for Official publication.

Machine score, human review, execution time, token usage, and cost remain
separate fields. Missing token or cost data is shown as unreported, not zero.

## Public-test and contamination limits

The complete scored manifest and case suite are copied into the Agent
workspace and exposed through `CAGB_TASK_MANIFEST_PATH` and
`CAGB_PUBLIC_TESTS_PATH`. Public tests make the benchmark inspectable and
easier to extend, but allow test-specific hardcoding. Source review, full run
evidence, task rotation, and independent reruns are therefore required for
Official publication.

Reproduce tasks use licensed open-source games and cannot eliminate pretraining
or prior-source exposure. During a controlled run, the agent receives the
prompt and reference captures but not the upstream source. Reference task
variants are released after retirement.
