# Published results

GameBench 0.6 uses a small Git-reviewed ledger:

- `lite/index.json` discovers accepted flat results;
- `lite/<benchmark-version>/<series-id>.json` is an immutable validated `result.json` copy.

Use `pnpm cagb campaign publish --id <campaign-id>` rather than editing either file. Publishing requires every preregistered cell to have one complete clean-tree Official run, exact four-task coverage, valid release/Campaign/source/artifact hashes, reproducible score arithmetic, and a passing credential-pattern scan. Campaign rows are appended to the flat index as one locked batch.

The historical `index.json` and `publications/` files remain data for older site pages. The 0.6 CLI does not generate that protocol.

Generated workspaces, source archives, provider responses, credentials, private trajectories, and complete traces stay outside Git.
