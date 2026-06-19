# ─────────────────────────────────────────────────────────────────────────────
# Nexari Platform — multi-stage Docker image
#
# Stage 1 (builder): installs all deps + compiles every package.
# Stage 2 (runtime): slim node + system media tools, copies only built artefacts.
#
# Build args:
#   SKIP_PLAYWRIGHT=1   Skip Chromium install (~600 MB). Disables HTML5 thumbnails.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-bookworm AS builder

ARG PNPM_VERSION=9

# Enable corepack so pnpm is available without a separate install step
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /build

# Copy workspace manifest + lockfile first so dep install is cached independently
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# Copy package manifests for each workspace package (needed before pnpm install)
COPY packages/db/package.json      packages/db/
COPY packages/shared/package.json  packages/shared/
COPY apps/api/package.json         apps/api/
COPY apps/ds/package.json          apps/ds/

# Install all dependencies (no-frozen: allows new deps added since last lock update)
RUN pnpm install --no-frozen-lockfile

# Copy full source
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/ds/  apps/ds/

# Build in dependency order
RUN pnpm --filter @signage/db     build
RUN pnpm --filter @signage/shared build
RUN pnpm --filter @signage/api    build
RUN pnpm --filter @signage/ds     build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ARG SKIP_PLAYWRIGHT=0

LABEL org.opencontainers.image.title="Nexari Platform"
LABEL org.opencontainers.image.source="https://github.com/nexari/platform"

# ── System tools used by the API at runtime ───────────────────────────────────
# ffmpeg        — video transcoding + thumbnail extraction
# ghostscript   — PDF thumbnail rendering (first page → JPEG)
# libreoffice   — PPTX/PPT/document thumbnail rendering
# poppler-utils — pdftoppm / pdfinfo used in media processing
# fonts         — required for LibreOffice rendering to look correct
# zip/unzip     — HTML5 package extraction
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ghostscript \
    libreoffice-impress \
    libreoffice-writer \
    libreoffice-calc \
    fonts-liberation \
    fonts-noto-core \
    fonts-dejavu-core \
    poppler-utils \
    zip \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── Playwright / Chromium (optional — set SKIP_PLAYWRIGHT=1 to skip) ─────────
# Required only for HTML5 package thumbnail generation.
# Saves ~600 MB when disabled.
RUN if [ "$SKIP_PLAYWRIGHT" != "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        libnss3 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
        libpango-1.0-0 libcairo2 libasound2 && \
      rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

# Copy pnpm store + node_modules from builder (production deps only)
COPY --from=builder /build/node_modules              ./node_modules
COPY --from=builder /build/packages/db/node_modules  ./packages/db/node_modules
COPY --from=builder /build/packages/db/dist          ./packages/db/dist
COPY --from=builder /build/packages/db/package.json  ./packages/db/package.json
COPY --from=builder /build/packages/db/scripts       ./packages/db/scripts
COPY --from=builder /build/packages/db/migrations    ./packages/db/migrations

COPY --from=builder /build/packages/shared/node_modules  ./packages/shared/node_modules
COPY --from=builder /build/packages/shared/dist          ./packages/shared/dist
COPY --from=builder /build/packages/shared/package.json  ./packages/shared/package.json

COPY --from=builder /build/apps/api/node_modules  ./apps/api/node_modules
COPY --from=builder /build/apps/api/dist          ./apps/api/dist
COPY --from=builder /build/apps/api/package.json  ./apps/api/package.json

# DS static files (served by API for kiosk/kitchen URLs + nginx for the SPA)
COPY --from=builder /build/apps/ds/dist  ./apps/ds/dist

# Root package.json so npm_package_version is available in the process
COPY --from=builder /build/package.json ./package.json

# Copy workspace definition so db migrate script resolves paths correctly
COPY --from=builder /build/pnpm-workspace.yaml ./pnpm-workspace.yaml

# ── Install Playwright browser binaries (if enabled) ─────────────────────────
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN if [ "$SKIP_PLAYWRIGHT" != "1" ]; then \
      cd apps/api && node -e "require('./dist/index.js')" 2>/dev/null || true && \
      npx --yes playwright@latest install chromium --with-deps 2>/dev/null || true; \
    fi

# ── Persistent data ───────────────────────────────────────────────────────────
# Uploads live outside the container — mount as a named volume
RUN mkdir -p /var/signage/uploads /var/signage/tizen /var/signage/android

# ── Runtime environment defaults ──────────────────────────────────────────────
# These are fixed by the container layout — partners do NOT set these in .env
ENV STORAGE_ROOT=/var/signage/uploads
ENV FFMPEG_PATH=ffmpeg
ENV FFPROBE_PATH=ffprobe
ENV LIBREOFFICE_PATH=soffice
ENV GHOSTSCRIPT_PATH=gs
ENV API_PORT=3000
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=2048

EXPOSE 3000

# ── Healthcheck ───────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
