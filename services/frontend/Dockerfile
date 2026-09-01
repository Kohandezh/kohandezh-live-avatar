# Build context is the repository root (see docker-compose.yml) so the Nginx config in
# infra/nginx/ stays the single source of truth for the reverse proxy.

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.1.2
COPY services/frontend/package.json services/frontend/pnpm-lock.yaml services/frontend/pnpm-workspace.yaml services/frontend/.npmrc ./
RUN pnpm install --frozen-lockfile
COPY services/frontend/ ./
# Only VITE_* values are baked in; they are public by design (see .env.production).
RUN pnpm build

FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -q -O - http://127.0.0.1/ >/dev/null || exit 1
