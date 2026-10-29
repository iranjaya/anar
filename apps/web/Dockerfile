FROM node:24.22.1-bookworm-slim AS base
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.28.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @anar/web...
COPY packages/domain/src packages/domain/src
COPY packages/domain/tsconfig.json packages/domain/tsconfig.json
COPY apps/web/app apps/web/app
COPY apps/web/components apps/web/components
COPY apps/web/lib apps/web/lib
COPY apps/web/mock apps/web/mock
COPY apps/web/modules apps/web/modules
COPY apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/tsconfig.json apps/web/proxy.ts apps/web/

FROM base AS dev
CMD ["sh", "-c", "pnpm --filter @anar/domain build && (pnpm --filter @anar/domain watch & exec pnpm --filter @anar/web dev --hostname 0.0.0.0)"]

FROM base AS build
RUN pnpm --filter @anar/domain build && pnpm --filter @anar/web build
RUN test -f apps/web/.next/standalone/apps/web/server.js

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
