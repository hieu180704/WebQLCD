# Image ứng dụng (target app) và image chạy migration (target migrate). Dùng qua docker-compose.yml.
FROM node:24.18.1-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build import module DB (client.ts ném lỗi khi thiếu biến) nhưng không truy vấn: URL giả, chỉ có ở stage này.
ENV DATABASE_URL=postgres://build@127.0.0.1:1/build
RUN npm run build

# Chỉ dependencies production: migrator của drizzle-orm + pg, không cần drizzle-kit.
FROM node:24.18.1-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./scripts/migrate.mjs
USER node
CMD ["node", "scripts/migrate.mjs"]

FROM node:24.18.1-alpine AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
