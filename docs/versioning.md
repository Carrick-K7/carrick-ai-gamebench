# Versioning

GameBench 0.6 is the new lightweight baseline.

## Benchmark releases

`benchmark/releases/<version>.json` freezes:

- the four task IDs, semantic versions, and content hashes;
- canonical evaluation seed `104729`;
- one Agent invocation per task;
- equal-weight Build scoring.

Any change to a prompt, state schema, public case, point allocation, task set, canonical seed, time budget, hard gate, or scoring interpretation requires a new Benchmark minor release such as `0.7.0`.

Patch releases are reserved for changes that cannot affect score meaning: documentation, UI wording, diagnostics, and equivalent performance fixes. If a bug fix may change task outcomes, it is not a patch.

0.6.1 is a patch to the 0.6.0 development baseline. Its new release lock differs only in `benchmark_version`; task IDs/hashes, seed, invocation count, and scoring remain identical. Packages and the Git tag use 0.6.1, while old results, raw-run directories, and Campaign Plans keep their original 0.6.0 versions and hashes. New runs and Campaign selection default to the installed release; integrity checks resolve the exact release named by each record. A patch does not authorize reusing an old Campaign cell or merging versioned leaderboards.

Before publishing a release:

1. choose the semantic version;
2. write and review its immutable release lock;
3. run `pnpm check` and `pnpm cagb doctor`;
4. commit the complete source;
5. create the matching immutable Git tag `v<version>`.

## Task versions

Task IDs end in `.vN`, where `N` equals the task semantic major version. Score-affecting changes create a new task major and a new benchmark release. New files are included in the task content hash.

Retired task packages are excluded from active discovery. Historical release locks and Git tags preserve their identity; the 0.6 runtime is not required to expose old CLI workflows.

## Result schema

Benchmark version and result schema version are independent. GameBench 0.6 uses flat `result.json` schema version 2, which adds an optional preregistered Campaign binding. A future benchmark release may reuse schema 2 if its result structure is unchanged; historical result files are never rewritten.

## Long-term path

0.6.x calibrates the four-task suite and six-player Texas Hold'em contract. Later 0.x minors may replace tasks or refine scoring with explicit release boundaries. Version 1.0 should be reserved for a methodology and result protocol stable enough to support long-term public comparison.
