# Result submission policy

GameBench accepts public result candidates as generated, reviewable data—not
as unverified leaderboard claims.

## Submission classes

- **Experimental** may be partial, single-seed, locally attested, or awaiting
  independent verification. Limitations must be explicit.
- **Official candidate** is an internal execution profile, not a public tier.
  It covers every release task and all fixed seeds in a clean checkout.
- **Official** is published only after maintainers rerun or reproduce the full
  matrix in a controlled environment and verify network policy, evidence,
  source export, rebuild, score, image digest, and licensing.

External submissions therefore request Experimental publication. A strong
candidate can be selected for a separate maintainer-controlled Official run;
the submitted run itself is not relabeled.

## Required contents

A result PR contains:

1. one new immutable file under `results/publications/`;
2. the matching append-only entry in `results/index.json`;
3. no raw run workspace, trajectory, provider response, credential, private
   vote, or full trace;
4. content-addressed object references for clean source, playable output,
   public screenshots, and applicable third-party license records.

Objects must be uploaded before the manifest is proposed. Every scored run
must include a clean-source reproduction record. The exact Benchmark version,
task hashes, model parameters, Agent/harness identity, execution environment,
seed, attempt, exit status, and missing telemetry remain visible.

Use the CLI rather than editing publication JSON:

```bash
pnpm cagb publish \
  --series runs/<benchmark-version>/<series-id> \
  --tier experimental \
  --objects <object-root> \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication \
  --results results \
  --objects <object-root>
```

## Review rules

- Existing Publication JSON is never edited or deleted.
- A correction creates a new publication and marks the old index entry
  `superseded`.
- A withdrawn result stays addressable with a reason recorded in the PR.
- Scores from different Benchmark versions are not compared or ranked
  together.
- License ambiguity, missing objects, secret-scan failures, inconsistent
  hashes, or misleading configuration metadata block publication.
- Maintainers may reproduce a candidate before accepting even an Experimental
  entry.

See [results and publication](results-and-publication.md) for identity and
storage details and [methodology](methodology.md) for the scoring contract.
