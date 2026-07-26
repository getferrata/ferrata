# Build and run Ferrata in one container. SQLite lives on the /data volume,
# so the volume is the whole state: back it up, and you have backed up
# everything.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable pnpm
# Native module toolchain, used only if a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable pnpm
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN corepack enable pnpm
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    FERRATA_DB_PATH=/data/ferrata.db \
    FERRATA_LOG_DIR=/data/logs
COPY --from=build /app ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
CMD ["pnpm", "start"]
