# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
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
COPY --from=builder --chown=kelpie:nodejs /app/scripts ./scripts
USER kelpie
EXPOSE 3000
CMD ["node", "server.js"]
