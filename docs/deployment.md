# Static deployment

GameBench 0.6.1 builds static artifacts; it does not introduce an application
server, database, account system, or public write endpoint. No production runtime,
domain, systemd unit, or deployment is currently selected on `tencent-sg`.

- The trusted Astro site is a build artifact, not proof of a live service.
- A future runtime must isolate untrusted game bundles on a separate origin.
- `apps/reviewer` remains loopback-only and is not deployed.
- Domain names and deployment scripts retained under `infra/` are historical
  examples, not current host-level status or permission to deploy.

Build the site with:

```bash
pnpm --filter @carrick/gamebench-site build
```

The example Caddy configuration in `infra/Caddyfile.example` illustrates
separate-origin isolation and `connect-src 'none'`. Do not run a deployment
script or add Pages, Zeabur, an image, or another target until the maintainer
chooses a concrete runtime. Releasing a Git tag is not a deployment request.

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
