# Telegram Gateway Dockerfile
FROM oven/bun:1-alpine AS base

WORKDIR /app

# Copy and install dependencies first (for caching)
COPY package.json ./
RUN bun install

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build
RUN bun run build

# Production stage
FROM oven/bun:1-alpine AS production

WORKDIR /app

# Copy built artifacts
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
