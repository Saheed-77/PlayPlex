# The UI is a pile of static files. nginx serves them and proxies /api to the backend, so
# the browser only ever talks to one origin — which is what makes the JWT cookie
# `SameSite=Lax` work without CORS, and what makes `EventSource` behave.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `http` bakes in the real transport: same-origin /api, no demo server, no demo panel.
ENV VITE_API_MODE=http
RUN npm run build

# ── run ──────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD ["sh", "-c", "wget -qO- http://127.0.0.1/ >/dev/null || exit 1"]
