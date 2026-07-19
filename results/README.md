# Published results

This directory is the small, Git-reviewed public result ledger:

- `index.json` is the mutable discovery index used by the static site.
- `publications/<sha256>.json` contains immutable publication manifests.
- large source, playable, screenshot, and evidence artifacts live in the
  content-addressed object store and are referenced by hash.

Official publications must contain every task and fixed seed from their v2
release lock, with independent verification for every included run.
Experimental publications may be partial or unverified and are always
displayed separately.

Local run bundles, trajectories, provider responses, and private reviewer data
remain under ignored storage. Never copy a raw `source.tar.zst` directly into
the public store; use `cagb publish`, which exports an allowlisted clean source.
