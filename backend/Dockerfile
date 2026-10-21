# syntax=docker/dockerfile:1
# BookLeaf API - multi-stage build. Runtime image has no dev dependencies or sources.

FROM node:22-bookworm-slim AS base
# Prisma's query engine needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npx prisma generate && npm run build \
  && npm prune --omit=dev && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production PORT=4000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node seed ./seed
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrate, seed (idempotent), then exec so node receives SIGTERM directly for graceful shutdown.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed/seed.js && exec node dist/server.js"]
