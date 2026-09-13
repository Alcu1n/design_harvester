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
ENV NODE_ENV=production
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
USER node
CMD ["node","apps/web/server.js"]
FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN node docker/install-agy.mjs
RUN mkdir -p /data/library /auth /work && chown -R node:node /data /auth /work
USER node
ENV LIBRARY_PATH=/data/library GEMINI_AUTH_HOME=/auth AGY_AUTH_HOME=/auth/antigravity AGY_BIN=/usr/local/bin/agy TMPDIR=/work
CMD ["pnpm","worker"]
FROM base AS egress
USER node
CMD ["pnpm","--filter","@harvester/core","exec","tsx","src/proxy.ts"]
FROM mcr.microsoft.com/playwright:v1.58.2-noble AS browser
WORKDIR /browser
RUN npm install --omit=dev playwright@1.58.2
COPY docker/browser.mjs ./browser.mjs
USER pwuser
CMD ["node","browser.mjs"]
