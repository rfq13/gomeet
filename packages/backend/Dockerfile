# Build stage
FROM golang:1.21-alpine AS builder

# Install git and ca-certificates for go modules
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -o main ./cmd/server

# Final stage
FROM alpine:latest

# Install ca-certificates and tzdata for HTTPS requests and timezone support
RUN apk --no-cache add ca-certificates tzdata

# Create non-root user
RUN addgroup --system --gid 1001 golang && \
    adduser --system --uid 1001 golang

# Set working directory
WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /app/main .

# Copy timezone data
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Set permissions
RUN chown golang:golang /app/main

# Switch to non-root user
USER golang

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the binary
CMD ["./main"]