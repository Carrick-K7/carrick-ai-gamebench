FROM node:22.22.0-bookworm@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c

ENV CI=1
WORKDIR /benchmark

RUN corepack enable \
  && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/publisher/package.json packages/publisher/package.json
COPY packages/evaluator/package.json packages/evaluator/package.json
COPY apps/reviewer/package.json apps/reviewer/package.json
COPY benchmark/starters/vite-ts/package.json benchmark/starters/vite-ts/package.json
COPY benchmark/starters/vite-ts/pnpm-lock.yaml benchmark/starters/vite-ts/pnpm-lock.yaml

RUN pnpm install --frozen-lockfile
RUN pnpm --dir benchmark/starters/vite-ts fetch --ignore-workspace
RUN pnpm --filter @carrick/gamebench exec playwright install --with-deps chromium \
  && apt-get update \
  && apt-get install -y --no-install-recommends zstd \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm --dir benchmark/starters/vite-ts install --frozen-lockfile --offline --ignore-workspace
RUN pnpm --filter @carrick/gamebench... build

ENV CAGB_EVALUATOR_CONTAINER=1
ENTRYPOINT ["node", "packages/evaluator/dist/cli.js"]
CMD ["doctor"]
