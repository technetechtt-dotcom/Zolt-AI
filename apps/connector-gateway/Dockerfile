FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV ZOLT_ADVISORY_ONLY=true
COPY --from=build /app /app
EXPOSE 4001
CMD ["node", "apps/connector-gateway/dist/server.js"]
