FROM node:24.22.1-bookworm-slim AS base
WORKDIR /workspace
RUN npm install --global pnpm@11.28.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @anar/api... --filter @anar/db...
COPY packages/domain/src packages/domain/src
COPY packages/domain/tsconfig.json packages/domain/tsconfig.json
COPY packages/db/src packages/db/src
COPY packages/db/tsconfig.json packages/db/tsconfig.json
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json

FROM base AS dev
CMD ["sh", "-c", "pnpm --filter @anar/domain build && pnpm --filter @anar/db build && (pnpm --filter @anar/domain watch & exec pnpm --filter @anar/api dev)"]

FROM base AS build
RUN pnpm --filter @anar/domain build && pnpm --filter @anar/db build && pnpm --filter @anar/api build
RUN pnpm --filter @anar/api deploy --legacy --prod /app

FROM base AS migrate-build
COPY packages/db packages/db
RUN pnpm --filter @anar/db build && mkdir -p packages/db/migrations
RUN pnpm --filter @anar/db deploy --legacy --prod /migration

FROM node:24.22.1-bookworm-slim AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=migrate-build --chown=node:node /migration/package.json ./packages/db/package.json
COPY --from=migrate-build --chown=node:node /migration/dist ./packages/db/dist
COPY --from=migrate-build --chown=node:node /migration/node_modules ./packages/db/node_modules
COPY --from=migrate-build --chown=node:node /workspace/packages/db/migrations ./packages/db/migrations
USER node
CMD ["node", "packages/db/dist/migrate.js"]

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
RUN mkdir -p /var/lib/anar/uploads && chown node:node /var/lib/anar/uploads
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
