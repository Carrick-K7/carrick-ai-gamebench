# Results and publication

## Identity hierarchy

- A `series_id` ULID identifies one evaluation batch.
- A `run_id` ULID identifies one physical execution and is never reused.
- `configuration_id` hashes the benchmark release, Agent/model/harness
  configuration, prompt language, execution profile, and environment.
- `input_fingerprint` adds the task version/hash, seed, budget, and network
  policy. Equal fingerprints are reruns, not overwrites.
- `artifact_id` hashes file bytes or a canonical directory manifest.
- `publication_id` hashes the complete canonical publication payload.

Canonical JSON follows RFC 8785 for the JSON values accepted by GameBench and
all public content IDs use SHA-256.

## Storage boundary

Git is authoritative for release locks, `results/index.json`, and immutable
publication manifests. A filesystem-backed object store holds large public
artifacts:

```text
objects/sha256/<prefix>/<digest>/<file>
play/<playable-directory-digest>/index.html
```

The initial filesystem implementation exposes only `put`, `exists`, and
`resolveUrl`. Its keys remain valid if storage later moves to S3, R2, or MinIO.

Raw run logs, model/provider events, trajectories, environment files, and full
browser traces are audit-private. Clean public source is reconstructed from an
allowlist, scanned for credentials, rebuilt without model credentials, and
archived deterministically.

## Workflow

```bash
# Continue the same series for every task.
pnpm cagb run --task build.2048.v1 \
  --agent-command './agent' --agent-id agent --model model \
  --series 01K...

# Rebuild and verify an individual v2 run.
pnpm cagb verify-run --run runs/0.2.0/01K.../01K... \
  --verifier-id operator \
  --image-digest sha256:<digest> \
  --network-attestation not-required

# Publish metadata to Git and artifacts to the static object root.
pnpm cagb publish --series runs/0.2.0/01K... \
  --tier experimental \
  --objects .gamebench \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication --results results --objects .gamebench
```

An Official publication requires exactly one included run for every
release-task and fixed-seed cell, an `official-candidate` series, a clean
benchmark checkout, operator reproduction, an evaluator image digest, and a
non-unverified network attestation. Experimental publication requires at least
one included scored run.

Published manifests are immutable. A correction creates a new publication and
uses `--supersedes sha256:<old-id>` to update only the discovery index.
