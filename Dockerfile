# PennyHelm — self-hosted Docker image
# -------------------------------------
# Builds a minimal Node.js container that runs the Express + SQLite selfhost
# backend. No Firebase, no external CDNs, no telemetry. Data persists in
# /app/data — mount a volume there to keep it across container restarts.

# ---------- build stage ----------
FROM node:20-bookworm-slim AS build

# better-sqlite3 ships a prebuilt binary for most platforms, but fall back to
# source compilation if the arch doesn't match. Build tools are in this stage
# only — they don't ship in the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Strip out files the runtime doesn't need
RUN rm -rf .git .github .claude functions scripts auth_export.json \
    firebase.json firestore.rules firestore.indexes.json \
    *.md LICENSE

# ---------- runtime stage ----------
FROM node:20-bookworm-slim AS runtime

# wget is used by the HEALTHCHECK below; ca-certificates is good hygiene
# for any future outbound HTTPS (none today, but cheap to ship).
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Drop root privileges
RUN groupadd --system --gid 1001 pennyhelm \
    && useradd  --system --uid 1001 --gid pennyhelm --shell /sbin/nologin pennyhelm

WORKDIR /app

COPY --from=build --chown=pennyhelm:pennyhelm /app /app

# Persistent SQLite database lives here — mount a volume to keep data
RUN mkdir -p /app/data && chown pennyhelm:pennyhelm /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    PORT=8081 \
    HOST=0.0.0.0 \
    PENNYHELM_MODE=selfhost

USER pennyhelm
EXPOSE 8081

# Docker healthcheck — curl-free check using wget. /health returns 200 only
# when Express is up AND SQLite responds to a ping. 30s interval is polite;
# start-period gives the Node process time to spin up SQLite/WAL.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8081/health || exit 1

CMD ["node", "server.js"]
