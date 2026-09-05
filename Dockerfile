FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WHATSAPP_WEB_HOST=0.0.0.0
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY --from=build /app /app
RUN chmod +x /app/scripts/docker-entrypoint.sh
EXPOSE 3000 8789
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
