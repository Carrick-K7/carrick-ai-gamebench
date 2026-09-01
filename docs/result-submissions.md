# Result submission policy

## Official 0.6 results

The Official leaderboard accepts only project-operated canonical runs. A qualifying run must:

1. start from one clean repository commit;
2. bind to one committed Campaign Plan cell that declares the complete Agent, provider, model, adapter, and score-relevant parameters;
3. use that cell's preallocated series ID and invoke the Agent once for each of the four release tasks;
4. evaluate the frozen source once at seed `104729`;
5. contain four scored rows and an equal-weight Build mean;
6. pass `pnpm cagb check --run <directory>`;
7. pass the publication credential-pattern scan;
8. enter the append-only Git result index through review.

External runs and partial local runs are useful calibration evidence, but they are not relabeled Official. A Campaign cell is single-shot; repeating a configuration requires a newly committed Campaign Plan and new preallocated series IDs.

## What may be committed

Use:

```bash
pnpm cagb campaign publish --id <campaign-id> [--id <another-campaign-id>]
```

This validates the complete preregistered Campaign, creates one immutable flat result per cell under `results/lite/0.6.0/`, and atomically updates `results/lite/index.json` once.

Do not commit generated workspaces, source archives, raw provider responses, credentials, private trajectories, complete traces, or temporary logs. Per-task evidence remains in the local run directory unless a later artifact policy explicitly accepts it.

## Corrections and ranking

- Different benchmark versions are never ranked together.
- Existing published result JSON is not edited or overwritten.
- A correction requires a new canonical run and series ID.
- Build score is the only 0.6 ranking metric.
- Human feedback, usage, cost, time, and model reputation are not score inputs or tie-breakers.
- A secret pattern, identity mismatch, missing task, modified score, or incomplete coverage blocks publication.

Official means maintainer-operated and Git-reviewed. It does not assert independent reproduction, network isolation, or container attestation.
