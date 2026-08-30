# Published results

GameBench 0.6 uses a small Git-reviewed ledger:

- `lite/index.json` discovers accepted flat results;
- `lite/<benchmark-version>/<series-id>.json` is an immutable validated `result.json` copy.

Use `pnpm cagb publish --run <run-directory>` rather than editing either file. Publishing requires a complete clean-tree Official run, exact four-task coverage, valid release/source/artifact hashes, reproducible score arithmetic, and a passing credential-pattern scan.

The historical `index.json` and `publications/` files remain data for older site pages. The 0.6 CLI does not generate that protocol.

Generated workspaces, source archives, provider responses, credentials, private trajectories, and complete traces stay outside Git.
