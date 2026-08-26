FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
# Set working directory
WORKDIR /app
# Copy the monorepo root config files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy the apps and packages
COPY apps/raineinvest ./apps/raineinvest
# If you have packages/strategy, copy it too
COPY packages ./packages

# Install dependencies for the workspace
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the Next.js app
WORKDIR /app/apps/raineinvest
# Next.js standalone build requires setting this env var
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set correct permissions
COPY --from=builder /app/apps/raineinvest/public ./apps/raineinvest/public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/apps/raineinvest/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/raineinvest/.next/static ./apps/raineinvest/.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the server
CMD ["node", "apps/raineinvest/server.js"]
