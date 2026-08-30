# Results and publication

## Local result

`cagb bench` writes one directory:

```text
runs/0.6.0/<series-id>/
  result.json
  tasks/<task-id>/
    source.tar.zst
    source.sha256
    prompt.md
    agent.json
    agent.log
    build.log
    server.log
    score.json
    tests.json
    MANIFEST.sha256
    artifacts/          # failure-only screenshots/traces
```

`result.json` is the only public result protocol. It contains release and model identity, one row per task, one source hash and one evaluation per row, plus the Build aggregate.

## Validation

```bash
pnpm cagb check --run runs/0.6.0/<series-id>
```

The check rejects:

- a release, task, seed, or source mismatch;
- missing or extra task rows;
- modified or unlisted artifacts;
- a score whose test vector no longer reproduces its arithmetic;
- an incorrect aggregate;
- incomplete coverage when Official publication is requested.

The check does not rebuild or re-evaluate source. It is a low-cost integrity operation, not an independent verifier.

## Official publication

```bash
pnpm cagb publish --run runs/0.6.0/<series-id>
```

Publishing requires a clean-tree Official result with four scored tasks. It copies the flat result into `results/lite/0.6.0/` and appends `results/lite/index.json`. Existing IDs cannot be overwritten.

Official means project-operated canonical execution accepted through Git review. It does not mean independently reproduced. External or partial runs remain local/experimental data and are not added to the Official index.

## Corrections

Published JSON is immutable. A correction is a new benchmark run and series ID. Git history records index changes; existing result files are not edited in place.

Large generated workspaces, credentials, provider responses, and raw private trajectories must never be committed.
