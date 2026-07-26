# Static deployment

GameBench v0.3 has no application server, database, account system, or public
write endpoint.

- `gamebench.ai.carrick7.com` serves the trusted Astro build.
- `play.gamebench.ai.carrick7.com` serves content-addressed untrusted game
  bundles and downloadable public artifacts.
- `apps/reviewer` remains loopback-only and is not deployed.

Build the site with:

```bash
pnpm --filter @carrick/gamebench-site build
```

The example Caddy configuration in `infra/Caddyfile.example` isolates playable
JavaScript with a separate origin and `connect-src 'none'`. The deploy script
copies the exact static build into a Git-SHA release directory and atomically
updates the `current` symlink. The persistent object root is not replaced when
the site is deployed.

Public CI produces an immutable `gamebench-site-<git-sha>` artifact and
`site-build.json`; it does not hold production SSH credentials. The exact
handoff contract is documented in
[`infra/static-build-interface.md`](../infra/static-build-interface.md).
Promotion, Production Environment protection, domain state, and smoke
monitoring belong to the private Ops repository.

A backend becomes justified only when GameBench accepts untrusted uploads,
authenticated votes, online review assignments, or asynchronous evaluation
jobs. At that point PostgreSQL records intake and workflow state, while Git
publication manifests remain the public source of truth and object storage
continues to hold artifacts.
