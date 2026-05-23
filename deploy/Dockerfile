FROM oven/bun:latest AS builder
WORKDIR /app
COPY package*.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:prod

FROM oven/bun:latest
WORKDIR /app
COPY package*.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY server/ ./server/
COPY shared/ ./shared/
COPY src/config/grids.json ./src/config/
COPY --from=builder /app/dist/usaf ./dist/usaf

EXPOSE 8787
ENV STATIC_DIR=/app/dist/usaf
CMD ["bun", "run", "server/index.ts"]
