FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/core/package.json        ./packages/core/
COPY packages/copc/package.json        ./packages/copc/
COPY packages/measurements/package.json ./packages/measurements/
COPY packages/web/package.json         ./packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/

# Build all packages in dependency order
RUN pnpm --filter @lidar-viewer/core build
RUN pnpm --filter @lidar-viewer/copc build
RUN pnpm --filter @lidar-viewer/measurements build
RUN pnpm --filter @lidar-viewer/web build

# ── Serve with nginx ─────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS server

COPY --from=builder /app/packages/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Point cloud data directory — mount a volume here
RUN mkdir -p /data/pointclouds

EXPOSE 80
