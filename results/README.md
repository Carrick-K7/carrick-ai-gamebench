# Published results

This directory is the small, Git-reviewed public result ledger:

- `index.json` is the mutable discovery index used by the static site.
- `publications/<sha256>.json` contains immutable publication manifests.
- large source, playable, screenshot, license, and evidence artifacts live in
  content-addressed object storage and are referenced by hash.

For v0.5, one task has one included Agent submission and one sealed source
snapshot. Official qualification requires that same snapshot to be evaluated in
fresh environments under seeds `104729`, `130363`, and `155921`, with
independent reproduction and verification. Build is the primary leaderboard;
Reproduce is reported independently. Human review, when present, is an optional
non-scoring annotation.

Experimental publications may be partial or unverified and are displayed as
non-Official evidence with explicit task and seed coverage.

v0.1-v0.4 publication and release-lock readers remain supported. In that
history, each fixed seed was a fresh Agent development run and aggregate data
could include a Build/Reproduce Core score. Existing publication files and IDs
must never be rewritten to imitate v0.5.

Local submissions, evaluations, trajectories, provider responses, private
review data, and complete traces remain under ignored storage. Never copy a raw
source archive directly into the public store; use `cagb publish`, which exports
and validates allowlisted clean source.
