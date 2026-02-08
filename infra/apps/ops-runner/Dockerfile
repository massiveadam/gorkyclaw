# Ops Runner Dockerfile
FROM oven/bun:1-alpine AS base

# Install OpenSSH client for SSH connections
RUN apk add --no-cache openssh-client

WORKDIR /app

# Copy and install dependencies
COPY package.json ./
RUN bun install

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build
RUN bun run build

# Production stage
FROM oven/bun:1-alpine AS production

# Install OpenSSH client
RUN apk add --no-cache openssh-client

WORKDIR /app

# Copy built artifacts
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules

# Create directories
RUN mkdir -p /app/data /app/keys

EXPOSE 8080

CMD ["bun", "run", "dist/index.js"]
