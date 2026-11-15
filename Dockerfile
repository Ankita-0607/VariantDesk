# VariantDesk — single container (API + web UI). Build: docker build -t variantdesk .
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps ./apps
COPY data ./data
RUN npm run build -w apps/api && npm run build -w apps/web && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 VARIANTDESK_DATA_DIR=/app/data WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/data ./data
COPY scripts/docker-entrypoint.sh /usr/local/bin/
USER node
WORKDIR /app/apps/api
EXPOSE 3000
ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
