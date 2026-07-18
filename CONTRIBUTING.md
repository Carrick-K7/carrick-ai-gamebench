# Contributing

Use Node.js 22.12+ and the pnpm version declared in `package.json`.

```bash
pnpm install
pnpm check
```

Changes to a released task's prompt, fixtures, weights, tests, reference
captures, or state schema are benchmark changes and require a new task version.
Do not silently alter a task after results have been published.

Add new games as self-contained packages under
`benchmark/tasks/build/<game-slug>/vN/` or
`benchmark/tasks/reproduce/<game-slug>/vN/`. After changing the catalog, bump
the root package version and generate its immutable lock with:

```bash
pnpm build
pnpm cagb release-lock --write
pnpm check
```

Contributions containing third-party game material must include the exact
upstream URL, immutable commit, license, copyright notice, and per-file origin
in `THIRD_PARTY.yml`. Do not submit material with unclear redistribution terms.

Machine scoring contributions must remain deterministic and auditable. LLM/VLM
judgments belong in experimental reports, not the trusted score.
