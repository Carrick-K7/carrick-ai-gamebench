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
- Core is the equal-weight macro mean of the eight Build and Reproduce tasks.

A score is omitted until all tasks required by that board are present. The
aggregate output always reports coverage so a partial run cannot appear to be
a complete leaderboard entry.

Official candidates use three fresh attempts with seeds `104729`, `130363`,
and `155921`. The benchmark reports the task mean and population standard
deviation; it never selects the best attempt. Agent, model, harness, prompt
language, time, tokens, and cost are recorded independently. This follows the
agent-configuration and repeated-run distinction used by
[Artificial Analysis](https://artificialanalysis.ai/methodology/coding-agents-benchmarking).

## Browser protocol

The evaluator fixes Chromium, fonts through the evaluator image, a 1280×720
viewport, and device scale factor 1. It:

1. installs from a frozen pnpm lockfile;
2. builds the submission;
3. starts the preview server;
4. verifies bridge version 1 and validates the first snapshot;
5. executes real keyboard/pointer operations and controlled bridge actions;
6. validates snapshots against the task JSON Schema;
7. captures traces, failure screenshots, and declared visual checkpoints.

Reproduce screenshots use deterministic scenarios and explicit pixel
tolerances. No LLM or VLM contributes to the trusted machine score.

## Human playtesting

The local reviewer compares two candidates only when task ID, task version, and
prompt language match. Candidate identity and machine score remain hidden.
Reviewers can choose A, B, tie, or both bad and attach reason tags. Votes are
exported as JSONL with candidate hashes and randomized left-side assignment.

Human votes are not added to the machine score. A future hosted Arena can reuse
the same records for Bradley–Terry/Elo aggregation and confidence intervals,
following the pairwise, playable-output approach of
[Code Arena](https://arena.ai/blog/code-arena/).

## Public-test and contamination limits

Public tests make the benchmark inspectable and easier to extend, but allow
test-specific hardcoding. Source review, full run evidence, task rotation, and
independent reruns are therefore required for Official publication.

Reproduce tasks use licensed open-source games and cannot eliminate pretraining
or prior-source exposure. During a controlled run, the agent receives the
prompt and reference captures but not the upstream source. Reference task
variants are released after retirement.
