# ---- build stage: install all deps, compile client and server ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
RUN npm run build

# ---- runtime stage: production deps only, non-root user ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/systemtrace.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/api/health" || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/server/index.js"]
