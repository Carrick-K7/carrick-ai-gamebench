# Versioning

GameBench 0.7 adds independent Build and Play instruments to the lightweight 0.6 baseline. The four Build contracts remain unchanged; Play is a new visual-player measurement, not a reinterpretation of old results.

## Benchmark releases

`benchmark/releases/<version>.json` freezes:

- the four task IDs, semantic versions, and content hashes;
- canonical evaluation seed `104729`;
- one Agent invocation per task;
- equal-weight Build scoring;
- for 0.7, immutable Play game/resource hashes, visual protocol, per-game budgets, ten-episode coverage, seed-commitment policy and separate native metrics.

Any change to a prompt, state schema, public case, point allocation, task set, canonical seed, time budget, hard gate, or scoring interpretation requires a new Benchmark minor release such as `0.7.0`.

Patch releases are reserved for changes that cannot affect score meaning: documentation, UI wording, diagnostics, and equivalent performance fixes. If a bug fix may change task outcomes, it is not a patch.

0.6.1 is a patch to the 0.6.0 development baseline. Its new release lock differs only in `benchmark_version`; task IDs/hashes, seed, invocation count, and scoring remain identical. Packages and the Git tag use 0.6.1, while old results, raw-run directories, and Campaign Plans keep their original 0.6.0 versions and hashes. New runs and Campaign selection default to the installed release; integrity checks resolve the exact release named by each record. A patch does not authorize reusing an old Campaign cell or merging versioned leaderboards.

Before publishing a release:

1. choose the semantic version;
2. write and review its immutable release lock;
3. run `pnpm check` and `pnpm cagb doctor`;
4. commit and push the complete source, then follow that exact commit's `ci.yml` run to success;
5. create and push the matching immutable Git tag `v<version>`;
6. follow `benchmark-release.yml` through verification and GitHub Release evidence publication; never move a published tag or replace release assets.

For 0.7, run both `doctor --suite build` and `doctor --suite play` using the pinned runtime and separately installed audited Pi. Doctors do not run model inference. Software publication does not authorize paid Campaigns or production deployment.

## Task versions

Task IDs end in `.vN`, where `N` equals the task semantic major version. Score-affecting changes create a new task major and a new benchmark release. New files are included in the task content hash.

Retired task packages are excluded from active discovery. Historical release locks and Git tags preserve their identity; the 0.6 runtime is not required to expose old CLI workflows.

## Result schema

Benchmark version and result schema version are independent. GameBench 0.6 uses flat `result.json` schema version 2. GameBench 0.7 uses ReleaseLock v4, Campaign v2 and flat result v3 with `suite: build | play`. Historical readers dispatch by the record's version; historical result files are never rewritten, relabeled or silently merged into a newer leaderboard.

## Long-term path

0.6.x calibrates the four-task suite and six-player Texas Hold'em contract. Later 0.x minors may replace tasks or refine scoring with explicit release boundaries. Version 1.0 should be reserved for a methodology and result protocol stable enough to support long-term public comparison.
