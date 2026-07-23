# AGENTS.md — Carrick AI GameBench

This repository is designed for autonomous AI development, but it is not a
production web service.

## Required workflow

1. Read the relevant package and task contracts before editing.
2. Use the pinned Node and pnpm versions from `package.json`.
3. Run `pnpm check` before commit.
4. For evaluator or container changes, also run `pnpm docker:build` when a
   Docker daemon is available.
5. Commit only repository-owned files.
6. After push, follow the exact commit's `ci.yml` run to completion.

`pnpm check` includes type checking, unit tests, builds, benchmark task
validation, release-lock validation, and starter-template smoke tests. A
warm pnpm cache is not proof that starter templates work; preserve cold-cache
coverage in CI.

## Production boundary

- GameBench currently has no service, domain, systemd unit, or production
  deployment on `tencent-sg`.
- The evaluator Dockerfile exists because workload isolation is a product
  requirement, not because every Carrick application is containerized.
- Do not publish an image or add Pages, Zeabur, or another deployment target
  until the user chooses a concrete runtime.
- Host-level truth and inactive-service monitoring belong to the private
  `Carrick-K7/carrick-ops` repository.

## Secrets and results

- Never commit provider credentials or generated benchmark workspaces.
- Treat benchmark results as release artifacts only when they pass the
  repository validation and licensing rules.
