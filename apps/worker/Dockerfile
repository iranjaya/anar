FROM node:24.22.1-bookworm-slim AS base
WORKDIR /workspace
RUN npm install --global pnpm@11.28.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @anar/worker...
COPY apps/worker/src apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json

FROM base AS dev
CMD ["pnpm", "--filter", "@anar/worker", "dev"]

FROM base AS build
RUN pnpm --filter @anar/worker build
RUN pnpm --filter @anar/worker deploy --legacy --prod /app

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
USER node
CMD ["node", "dist/main.js"]
