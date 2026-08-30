# Contributing

Use Node.js 22.12+ and the pnpm version declared in `package.json`.

```bash
pnpm install
pnpm check
pnpm cagb doctor
```

Active games are self-contained Build packages under `benchmark/tasks/build/<game-slug>/vN/`. A score-affecting change to a prompt, fixture, point allocation, browser case, runtime policy, or state schema requires a new task major and benchmark minor release. Never silently edit an already published release lock.

After an intentional catalog change:

1. update package versions;
2. write and review `benchmark/releases/<version>.json` with exact task hashes;
3. update calibration fixtures and deficient-case coverage;
4. run the full checks above;
5. create the immutable Git tag only after merge.

Machine scoring must remain deterministic, public, and auditable. LLM/VLM judgments and human preference do not belong in the trusted score.

Result candidates follow the [result submission policy](docs/result-submissions.md). Official 0.6 results require a maintainer-operated canonical four-task run and `cagb check`; external runs are calibration evidence rather than self-declared leaderboard entries.

All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security or conduct concerns through [SECURITY.md](SECURITY.md).
