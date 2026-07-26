# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM base AS production-deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 kelpie \
  && mkdir -p /data/uploads \
  && chown -R kelpie:nodejs /data
COPY --from=builder /app/public ./public
COPY --from=builder --chown=kelpie:nodejs /app/.next/standalone ./
COPY --from=builder --chown=kelpie:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=kelpie:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=kelpie:nodejs /app/dist/jobs-worker.cjs ./scripts/jobs-worker.cjs
COPY --from=builder --chown=kelpie:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=production-deps --chown=kelpie:nodejs /app/node_modules ./node_modules
USER kelpie
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
