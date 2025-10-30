# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Build arguments for Vite environment variables
ARG VITE_API_URL=https://api-meet.filosofine.com
ARG VITE_API_BASE_URL=https://api-meet.filosofine.com
ARG VITE_WEBSOCKET_URL=wss://api-meet.filosofine.com/api/v1/ws
ARG VITE_LIVEKIT_URL=wss://livekit.filosofine.com
ARG VITE_DO_CDN_ENDPOINT
ARG VITE_DO_REGION

# Set environment variables for build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WEBSOCKET_URL=$VITE_WEBSOCKET_URL
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
ENV VITE_DO_CDN_ENDPOINT=$VITE_DO_CDN_ENDPOINT
ENV VITE_DO_REGION=$VITE_DO_REGION

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm@8

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Build the application with environment variables
RUN echo "Building with VITE_API_URL=$VITE_API_URL" && pnpm build

# Production stage
FROM node:20-alpine AS runner

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 svelte

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm@8

# Install all dependencies (SvelteKit needs dev dependencies for production)
RUN pnpm install --no-frozen-lockfile && \
    pnpm store prune

# Copy built application from builder stage (SvelteKit adapter-node output)
COPY --from=builder --chown=svelte:nodejs /app/build ./build

# Copy static assets
COPY --from=builder --chown=svelte:nodejs /app/static ./static

# Copy package.json for production dependencies
COPY --from=builder --chown=svelte:nodejs /app/package.json ./package.json

# Create health check script
RUN echo 'const http = require("http");\n\
const options = {\n\
  hostname: "localhost",\n\
  port: process.env.PORT || 5173,\n\
  path: "/health",\n\
  timeout: 2000\n\
};\n\
const request = http.request(options, (res) => {\n\
  if (res.statusCode === 200) {\n\
    process.exit(0);\n\
  } else {\n\
    process.exit(1);\n\
  }\n\
});\n\
request.on("error", () => {\n\
  process.exit(1);\n\
});\n\
request.end();' > healthcheck.js

# Set permissions
RUN chown svelte:nodejs /app/healthcheck.js

# Switch to non-root user
USER svelte

# Expose port
EXPOSE 5173

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node healthcheck.js

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "build/index.js"]