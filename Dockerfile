# SmartNest production image: API server + built web app on one port.
# Build:  docker build -t smartnest .
# Run:    see docs/deployment.md (needs DATABASE_URL, CREDENTIAL_ENCRYPTION_KEY, STREAM_TOKEN_SECRET)

FROM node:25-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
COPY apps/web/package.json apps/web/
COPY apps/mock-ha/package.json apps/mock-ha/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --workspaces --include-workspace-root

FROM node:25-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 smartnest
COPY --from=build --chown=smartnest /app/node_modules ./node_modules
COPY --from=build --chown=smartnest /app/package.json ./
COPY --from=build --chown=smartnest /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=smartnest /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=smartnest /app/apps/server/package.json ./apps/server/
COPY --from=build --chown=smartnest /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=smartnest /app/apps/server/prisma ./apps/server/prisma
COPY --from=build --chown=smartnest /app/apps/web/dist ./apps/web/dist
USER smartnest
ENV STATIC_DIR=/app/apps/web/dist PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/server/prisma/schema.prisma && node apps/server/dist/index.js"]
