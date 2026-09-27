# Results and publication

## Local result

`cagb bench` writes one directory:

```text
runs/<benchmark-version>/<series-id>/
  .series.json
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

`result.json` is the only public result protocol. The tree above describes Build: release/model identity, one row per task, one source hash and one evaluation per row, plus the Build aggregate. In 0.7, flat result v3 selects exactly one suite. Play instead records per-game episode vectors, game/trajectory hashes and separate native metrics; its raw episode evidence lives under `tasks/<task-id>/episodes/`. See [Play operations](play-operations.md).

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

Build checks do not rebuild or re-evaluate source. Play checks additionally replay recorded actions against the frozen engine and browser, without model calls. Checks are integrity operations, not independent model measurements. Historical records resolve against their own unchanged locks, so the command above remains valid. New runs use 0.7.0; do not rename or relabel old evidence.

## Official publication

```bash
pnpm cagb campaign check
pnpm cagb campaign publish --id <campaign-id> [--id <another-campaign-id>]
```

Official runs are preregistered under `benchmark/campaigns/<version>/`. Each cell owns one preallocated series ID and cannot be developed twice. Publishing requires every planned cell to be a clean-tree Official result from the same Git commit with complete suite coverage: four scored Build tasks or both Play games with ten scored episodes each. Campaign publication validates all cells, writes checked flat snapshots into `results/lite/<benchmark-version>/`, and atomically appends all rows to `results/lite/index.json` under one lock. Existing IDs cannot be overwritten. Direct `cagb publish --run` rejects Campaign-affiliated results.

Official means project-operated canonical execution accepted through Git review. It does not mean independently reproduced. External or partial runs remain local/experimental data and are not added to the Official index.

## Corrections

Published JSON is immutable. A correction is a new benchmark run and series ID. Git history records index changes; existing result files are not edited in place.

Large generated workspaces, credentials, provider responses, and raw private trajectories must never be committed.
