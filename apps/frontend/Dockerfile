# Build context is the repository root (see docker-compose.yml) so the Nginx config in
# infra/nginx/ stays the single source of truth for the reverse proxy, and so the pnpm
# workspace files at the root are available to the install step.

FROM node:22-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@10.28.2
# Manifests first: this layer is cached until a dependency actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/
RUN pnpm install --frozen-lockfile --filter @app/frontend...
COPY apps/frontend/ apps/frontend/
# Only VITE_* values are baked in; they are public by design.
# The container serves the browser PWA target, so build just that one.
RUN pnpm --filter @app/frontend build:web

FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend/dist/web /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -q -O - http://127.0.0.1/ >/dev/null || exit 1
