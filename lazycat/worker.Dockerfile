FROM node:24-bookworm-slim AS base
RUN npm install --global pnpm@10.30.3
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile
COPY . .
FROM base AS web-build
RUN pnpm build
FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production IMPORT_PATH=/data/imports
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
USER node
CMD ["node","apps/web/server.js"]
FROM base AS worker-deps
RUN pnpm --filter @harvester/core deploy --legacy --prod /runtime/core
RUN node docker/install-agy.mjs
FROM node:24-bookworm-slim AS worker
RUN npm install --global pnpm@10.30.3 && rm -rf /root/.npm \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=worker-deps /runtime/core ./packages/core
COPY --from=worker-deps /usr/local/bin/agy /usr/local/bin/agy
COPY package.json pnpm-workspace.yaml tsconfig.json ./
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/worker/src ./apps/worker/src
COPY lazycat/worker-start.sh ./lazycat/worker-start.sh
RUN ln -s packages/core/node_modules node_modules \
    && mkdir -p /data/library /data/imports /auth /work && chown -R node:node /data /auth /work
USER node
ENV IMPORT_PATH=/data/imports LIBRARY_PATH=/data/library GEMINI_AUTH_HOME=/auth AGY_AUTH_HOME=/auth/antigravity AGY_BIN=/usr/local/bin/agy TMPDIR=/work
CMD ["pnpm","worker"]
FROM node:24-bookworm-slim AS egress
WORKDIR /app
RUN npm install --omit=dev tsx@4.21.0 ipaddr.js@2.3.0 zod@4.3.6 && rm -rf /root/.npm
COPY packages/core/src/proxy.ts packages/core/src/security.ts packages/core/src/contracts.ts ./src/
USER node
CMD ["node","--import","tsx","src/proxy.ts"]
FROM mcr.microsoft.com/playwright:v1.58.2-noble AS browser
WORKDIR /browser
RUN npm install --omit=dev playwright@1.58.2
COPY docker/browser.mjs ./browser.mjs
USER pwuser
CMD ["node","browser.mjs"]

FROM worker AS lazycat
ENTRYPOINT ["sh", "/app/lazycat/worker-start.sh"]
