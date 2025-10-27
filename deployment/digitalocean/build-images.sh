#!/bin/bash

# GoMeet DigitalOcean Docker Build and Push Script
# Script untuk build dan push Docker images ke DigitalOcean Container Registry
# Support multi-arch builds dan optimization untuk production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="/tmp/gomeet-builds"
LOG_FILE="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"
BUILD_ID="build-$(date +%Y%m%d-%H%M%S)"

# Registry configuration
REGISTRY_NAME="registry.digitalocean.com"
REGISTRY_NAMESPACE="gomeet"
REGISTRY="$REGISTRY_NAME/$REGISTRY_NAMESPACE"
DEFAULT_TAG="latest"

# Build configuration
PUSH_IMAGES=true
MULTI_ARCH=true
PLATFORMS="linux/amd64,linux/arm64"
BUILD_ARGS=()
CACHE_FROM=true
CACHE_TO=true
BUILDKIT_OUTPUT="type=registry"

# Services to build
declare -A SERVICES=(
    ["auth-service"]="packages/backend"
    ["meeting-service"]="packages/backend"
    ["signaling-service"]="packages/backend"
    ["chat-service"]="packages/backend"
    ["turn-service"]="packages/backend"
    ["frontend"]="packages/frontend"
    ["livekit-sfu"]="packages/backend"
    ["livekit-recorder"]="packages/backend"
    ["traefik"]="."
    ["prometheus"]="."
    ["grafana"]="."
)

# Dockerfiles
declare -A DOCKERFILES=(
    ["auth-service"]="packages/backend/Dockerfile"
    ["meeting-service"]="packages/backend/Dockerfile"
    ["signaling-service"]="packages/backend/Dockerfile"
    ["chat-service"]="packages/backend/Dockerfile"
    ["turn-service"]="packages/backend/Dockerfile"
    ["frontend"]="packages/frontend/Dockerfile"
    ["livekit-sfu"]="packages/backend/Dockerfile"
    ["livekit-recorder"]="packages/backend/Dockerfile"
    ["traefik"]="deployment/digitalocean/dockerfiles/Dockerfile.traefik"
    ["prometheus"]="deployment/digitalocean/dockerfiles/Dockerfile.prometheus"
    ["grafana"]="deployment/digitalocean/dockerfiles/Dockerfile.grafana"
)

# Build contexts
declare -A BUILD_CONTEXTS=(
    ["auth-service"]="packages/backend"
    ["meeting-service"]="packages/backend"
    ["signaling-service"]="packages/backend"
    ["chat-service"]="packages/backend"
    ["turn-service"]="packages/backend"
    ["frontend"]="packages/frontend"
    ["livekit-sfu"]="packages/backend"
    ["livekit-recorder"]="packages/backend"
    ["traefik"]="deployment/digitalocean/dockerfiles"
    ["prometheus"]="deployment/digitalocean/dockerfiles"
    ["grafana"]="deployment/digitalocean/dockerfiles"
)

# Global variables
VERBOSE=false
DRY_RUN=false
SKIP_BUILD=false
SKIP_PUSH=false
FORCE_BUILD=false
PARALLEL_BUILDS=true
MAX_PARALLEL=4
SERVICES_TO_BUILD=()
CUSTOM_TAG=""

# Functions
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case "$level" in
        "INFO")  echo -e "${BLUE}[$timestamp] INFO:${NC}  $message" | tee -a "$LOG_FILE" ;;
        "SUCCESS") echo -e "${GREEN}[$timestamp] SUCCESS:${NC} $message" | tee -a "$LOG_FILE" ;;
        "WARNING") echo -e "${YELLOW}[$timestamp] WARNING:${NC} $message" | tee -a "$LOG_FILE" ;;
        "ERROR") echo -e "${RED}[$timestamp] ERROR:${NC}  $message" | tee -a "$LOG_FILE" ;;
        "DEBUG") [[ "$VERBOSE" == true ]] && echo -e "${PURPLE}[$timestamp] DEBUG:${NC} $message" | tee -a "$LOG_FILE" ;;
        "PHASE") echo -e "\n${CYAN}========== PHASE: $message ==========${NC}" | tee -a "$LOG_FILE" ;;
    esac
}

# Progress indicator
show_progress() {
    local current="$1"
    local total="$2"
    local desc="$3"
    local percent=$((current * 100 / total))
    local filled=$((percent / 2))
    local empty=$((50 - filled))
    
    printf "\r${BLUE}[%3d%%]${NC} [" "$percent"
    printf "%*s" "$filled" | tr ' ' '='
    printf "%*s" "$empty" | tr ' ' '-'
    printf "] $desc"
    
    if [[ "$current" == "$total" ]]; then
        echo ""
    fi
}

# Error handling
handle_error() {
    local exit_code=$?
    local line_number=$1
    
    log "ERROR" "Build failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    # Check required tools
    local tools=("docker" "jq")
    local missing_tools=()
    
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log "ERROR" "Missing required tools: ${missing_tools[*]}"
        exit 1
    fi
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log "ERROR" "Docker daemon is not running"
        exit 1
    fi
    
    # Check Docker BuildKit
    if ! docker buildx version &> /dev/null; then
        log "WARNING" "Docker BuildKit not available, falling back to classic builder"
        MULTI_ARCH=false
    fi
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    log "SUCCESS" "All prerequisites satisfied"
}

# Setup Docker BuildKit
setup_buildkit() {
    log "PHASE" "Setting Up Docker BuildKit"
    
    if [[ "$MULTI_ARCH" == true ]]; then
        # Create and use BuildKit builder
        local builder_name="gomeet-builder"
        
        if ! docker buildx ls | grep -q "$builder_name"; then
            log "INFO" "Creating BuildKit builder: $builder_name"
            docker buildx create --name "$builder_name" --driver docker-container --bootstrap
        fi
        
        docker buildx use "$builder_name"
        log "SUCCESS" "BuildKit builder configured"
    else
        log "INFO" "Using classic Docker builder"
    fi
}

# Login to registry
login_to_registry() {
    log "PHASE" "Logging In to Container Registry"
    
    if [[ "$DRY_RUN" == true ]] || [[ "$SKIP_PUSH" == true ]]; then
        log "INFO" "Skipping registry login"
        return 0
    fi
    
    # Check if already logged in
    if docker info | grep -q "$REGISTRY_NAME"; then
        log "INFO" "Already logged in to $REGISTRY_NAME"
        return 0
    fi
    
    # Try to get DigitalOcean API token
    local do_token=""
    if [[ -f "$HOME/.config/doctl/config.yaml" ]]; then
        do_token=$(grep "access-token" "$HOME/.config/doctl/config.yaml" | awk '{print $2}' || echo "")
    fi
    
    if [[ -n "$do_token" ]]; then
        log "INFO" "Logging in to DigitalOcean Container Registry"
        echo "$do_token" | docker login "$REGISTRY_NAME" -u "$do_token" --password-stdin
    else
        log "WARNING" "DigitalOcean token not found, attempting manual login"
        docker login "$REGISTRY_NAME"
    fi
    
    log "SUCCESS" "Logged in to container registry"
}

# Create Dockerfiles if they don't exist
create_dockerfiles() {
    log "PHASE" "Creating Dockerfiles"
    
    local dockerfiles_dir="$SCRIPT_DIR/dockerfiles"
    mkdir -p "$dockerfiles_dir"
    
    # Create Traefik Dockerfile
    if [[ ! -f "$dockerfiles_dir/Dockerfile.traefik" ]]; then
        log "INFO" "Creating Traefik Dockerfile"
        cat > "$dockerfiles_dir/Dockerfile.traefik" << 'EOF'
FROM traefik:v3.0
LABEL maintainer="GoMeet Team"
LABEL version="3.0"
LABEL description="GoMeet Traefik Gateway"

# Copy custom configuration
COPY traefik.yml /etc/traefik/traefik.yml

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD traefik healthcheck --ping

EXPOSE 80 443 8080 8082

CMD ["traefik"]
EOF
    fi
    
    # Create Prometheus Dockerfile
    if [[ ! -f "$dockerfiles_dir/Dockerfile.prometheus" ]]; then
        log "INFO" "Creating Prometheus Dockerfile"
        cat > "$dockerfiles_dir/Dockerfile.prometheus" << 'EOF'
FROM prom/prometheus:v2.40.0
LABEL maintainer="GoMeet Team"
LABEL version="2.40.0"
LABEL description="GoMeet Prometheus Monitoring"

# Copy custom configuration
COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY rules/ /etc/prometheus/rules/

# Create data directory
RUN mkdir -p /prometheus

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9090/-/healthy || exit 1

EXPOSE 9090

VOLUME ["/prometheus"]

CMD ["--config.file=/etc/prometheus/prometheus.yml", \
     "--storage.tsdb.path=/prometheus", \
     "--web.console.libraries=/etc/prometheus/console_libraries", \
     "--web.console.templates=/etc/prometheus/consoles"]
EOF
    fi
    
    # Create Grafana Dockerfile
    if [[ ! -f "$dockerfiles_dir/Dockerfile.grafana" ]]; then
        log "INFO" "Creating Grafana Dockerfile"
        cat > "$dockerfiles_dir/Dockerfile.grafana" << 'EOF'
FROM grafana/grafana:9.3.0
LABEL maintainer="GoMeet Team"
LABEL version="9.3.0"
LABEL description="GoMeet Grafana Dashboard"

# Copy custom configuration
COPY grafana.ini /etc/grafana/grafana.ini
COPY provisioning/ /etc/grafana/provisioning/

# Install plugins
RUN grafana-cli plugins install grafana-clock-panel grafana-simple-json-datasource grafana-piechart-panel

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

EXPOSE 3000

VOLUME ["/var/lib/grafana"]

CMD ["grafana-server"]
EOF
    fi
    
    log "SUCCESS" "Dockerfiles created"
}

# Build single image
build_image() {
    local service="$1"
    local tag="$2"
    
    log "INFO" "Building image for $service:$tag"
    
    local dockerfile="${DOCKERFILES[$service]}"
    local context="${BUILD_CONTEXTS[$service]}"
    local full_image="$REGISTRY/$service:$tag"
    
    if [[ -z "$dockerfile" ]]; then
        log "ERROR" "No Dockerfile defined for $service"
        return 1
    fi
    
    if [[ ! -f "$PROJECT_ROOT/$dockerfile" ]]; then
        log "ERROR" "Dockerfile not found: $PROJECT_ROOT/$dockerfile"
        return 1
    fi
    
    # Change to project root
    cd "$PROJECT_ROOT"
    
    # Build arguments
    local build_cmd=("docker")
    
    if [[ "$MULTI_ARCH" == true ]]; then
        build_cmd+=("buildx" "build")
        build_cmd+=("--platform" "$PLATFORMS")
    else
        build_cmd+=("build")
    fi
    
    # Add build options
    if [[ "$CACHE_FROM" == true ]]; then
        build_cmd+=("--cache-from" "type=registry,ref=$full_image")
    fi
    
    if [[ "$CACHE_TO" == true ]]; then
        build_cmd+=("--cache-to" "type=inline")
    fi
    
    # Add build arguments
    for arg in "${BUILD_ARGS[@]}"; do
        build_cmd+=("--build-arg" "$arg")
    done
    
    # Add labels
    build_cmd+=("--label" "build.id=$BUILD_ID")
    build_cmd+=("--label" "build.timestamp=$(date -Iseconds)")
    build_cmd+=("--label" "service=$service")
    build_cmd+=("--label" "maintainer=GoMeet Team")
    
    # Add output configuration
    if [[ "$PUSH_IMAGES" == true ]] && [[ "$SKIP_PUSH" != true ]]; then
        if [[ "$MULTI_ARCH" == true ]]; then
            build_cmd+=("--output" "$BUILDKIT_OUTPUT")
        else
            build_cmd+=("--push")
        fi
    fi
    
    # Add Dockerfile and context
    build_cmd+=("-f" "$dockerfile")
    build_cmd+=("-t" "$full_image")
    build_cmd+=("$context")
    
    # Execute build
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would build: ${build_cmd[*]}"
        return 0
    fi
    
    log "DEBUG" "Building with: ${build_cmd[*]}"
    
    if "${build_cmd[@]}"; then
        log "SUCCESS" "Built $service:$tag"
        
        # Push single arch images if not using BuildKit
        if [[ "$MULTI_ARCH" != true ]] && [[ "$PUSH_IMAGES" == true ]] && [[ "$SKIP_PUSH" != true ]]; then
            log "INFO" "Pushing $full_image"
            docker push "$full_image"
        fi
    else
        log "ERROR" "Failed to build $service:$tag"
        return 1
    fi
}

# Build images in parallel
build_images_parallel() {
    local services=("$@")
    local total=${#services[@]}
    local current=0
    
    log "INFO" "Building $total images in parallel (max: $MAX_PARALLEL)"
    
    # Create temporary directory for job control
    local job_dir=$(mktemp -d)
    
    # Build images in batches
    for ((i=0; i<total; i+=MAX_PARALLEL)); do
        local batch=("${services[@]:i:MAX_PARALLEL}")
        local pids=()
        
        # Start parallel builds
        for service in "${batch[@]}"; do
            {
                build_image "$service" "$CUSTOM_TAG"
                echo "$service" > "$job_dir/$service.done"
            } &
            pids+=($!)
        done
        
        # Wait for batch to complete
        for pid in "${pids[@]}"; do
            if ! wait "$pid"; then
                log "ERROR" "One or more builds in batch failed"
                rm -rf "$job_dir"
                exit 1
            fi
        done
        
        current=$((current + ${#batch[@]}))
        show_progress $current $total "Building images"
    done
    
    rm -rf "$job_dir"
}

# Build images sequentially
build_images_sequential() {
    local services=("$@")
    local total=${#services[@]}
    local current=0
    
    log "INFO" "Building $total images sequentially"
    
    for service in "${services[@]}"; do
        ((current++))
        show_progress $current $total "Building $service"
        
        if ! build_image "$service" "$CUSTOM_TAG"; then
            log "ERROR" "Failed to build $service"
            exit 1
        fi
    done
}

# Main build function
build_images() {
    log "PHASE" "Building Docker Images"
    
    if [[ "$SKIP_BUILD" == true ]]; then
        log "INFO" "Skipping image build"
        return 0
    fi
    
    # Determine services to build
    if [[ ${#SERVICES_TO_BUILD[@]} -eq 0 ]]; then
        SERVICES_TO_BUILD=("${!SERVICES[@]}")
    fi
    
    log "INFO" "Building ${#SERVICES_TO_BUILD[@]} services: ${SERVICES_TO_BUILD[*]}"
    
    # Create Dockerfiles
    create_dockerfiles
    
    # Build images
    if [[ "$PARALLEL_BUILDS" == true ]] && [[ ${#SERVICES_TO_BUILD[@]} -gt 1 ]]; then
        build_images_parallel "${SERVICES_TO_BUILD[@]}"
    else
        build_images_sequential "${SERVICES_TO_BUILD[@]}"
    fi
    
    log "SUCCESS" "All images built successfully"
}

# Generate build report
generate_build_report() {
    log "PHASE" "Generating Build Report"
    
    local report_file="$LOG_DIR/build-report-$BUILD_ID.json"
    
    local report="{"
    report+="\"build_id\": \"$BUILD_ID\","
    report+="\"build_timestamp\": \"$(date -Iseconds)\","
    report+="\"registry\": \"$REGISTRY\","
    report+="\"tag\": \"$CUSTOM_TAG\","
    report+="\"multi_arch\": $MULTI_ARCH,"
    report+="\"platforms\": \"$PLATFORMS\","
    report+="\"services_built\": ["
    
    local first=true
    for service in "${SERVICES_TO_BUILD[@]}"; do
        if [[ "$first" == false ]]; then
            report+=","
        fi
        report+="\"$service\""
        first=false
    done
    
    report+="],"
    report+="\"images\": {"
    
    first=true
    for service in "${SERVICES_TO_BUILD[@]}"; do
        if [[ "$first" == false ]]; then
            report+=","
        fi
        report+="\"$service\": \"$REGISTRY/$service:$CUSTOM_TAG\""
        first=false
    done
    
    report+="}"
    report+="}"
    
    echo "$report" > "$report_file"
    
    log "SUCCESS" "Build report saved to: $report_file"
    
    # Display summary
    echo ""
    echo "🐳 Docker Build Summary:"
    echo "========================"
    echo "Build ID: $BUILD_ID"
    echo "Registry: $REGISTRY"
    echo "Tag: $CUSTOM_TAG"
    echo "Multi-arch: $MULTI_ARCH"
    echo "Platforms: $PLATFORMS"
    echo "Services built: ${#SERVICES_TO_BUILD[@]}"
    echo ""
    echo "📦 Images:"
    for service in "${SERVICES_TO_BUILD[@]}"; do
        echo "- $REGISTRY/$service:$CUSTOM_TAG"
    done
    echo ""
    echo "📁 Files:"
    echo "- Build log: $LOG_FILE"
    echo "- Build report: $report_file"
}

# Cleanup function
cleanup() {
    log "INFO" "Performing cleanup..."
    
    # Cleanup BuildKit builder if created
    if [[ "$MULTI_ARCH" == true ]]; then
        local builder_name="gomeet-builder"
        if docker buildx ls | grep -q "$builder_name"; then
            log "DEBUG" "Cleaning up BuildKit builder"
            docker buildx rm "$builder_name" || true
        fi
    fi
    
    # Cleanup temporary files
    find /tmp -name "gomeet-build-*" -type f -mtime +1 -delete 2>/dev/null || true
    
    log "INFO" "Cleanup completed"
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Docker Build and Push Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [SERVICES...]"
    echo ""
    echo "Options:"
    echo "  -h, --help                    Show this help message"
    echo "  -v, --verbose                 Enable verbose logging"
    echo "  -r, --registry REGISTRY       Container registry (default: $REGISTRY)"
    echo "  -t, --tag TAG                 Image tag (default: $DEFAULT_TAG)"
    echo "  --dry-run                     Simulate build without making changes"
    echo "  --skip-build                  Skip image build"
    echo "  --skip-push                   Skip image push"
    echo "  --force                       Force rebuild even if image exists"
    echo "  --no-multi-arch               Disable multi-architecture builds"
    echo "  --platforms PLATFORMS        Target platforms (default: $PLATFORMS)"
    echo "  --no-parallel                 Disable parallel builds"
    echo "  --max-parallel NUM            Maximum parallel builds (default: $MAX_PARALLEL)"
    echo "  --build-arg ARG=VAL           Add build argument"
    echo "  --no-cache                    Disable build cache"
    echo ""
    echo "Services:"
    for service in "${!SERVICES[@]}"; do
        echo "  - $service"
    done
    echo ""
    echo "Examples:"
    echo "  $0                           # Build all services"
    echo "  $0 --tag v1.0.0             # Build all with custom tag"
    echo "  $0 auth-service frontend    # Build specific services"
    echo "  $0 --no-multi-arch --force  # Force rebuild single arch"
    echo "  $0 --dry-run                # Simulate build"
}

# Main execution function
main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -r|--registry)
                REGISTRY="$2"
                shift 2
                ;;
            -t|--tag)
                CUSTOM_TAG="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-push)
                SKIP_PUSH=true
                shift
                ;;
            --force)
                FORCE_BUILD=true
                shift
                ;;
            --no-multi-arch)
                MULTI_ARCH=false
                shift
                ;;
            --platforms)
                PLATFORMS="$2"
                shift 2
                ;;
            --no-parallel)
                PARALLEL_BUILDS=false
                shift
                ;;
            --max-parallel)
                MAX_PARALLEL="$2"
                shift 2
                ;;
            --build-arg)
                BUILD_ARGS+=("$2")
                shift 2
                ;;
            --no-cache)
                CACHE_FROM=false
                CACHE_TO=false
                shift
                ;;
            -*)
                log "ERROR" "Unknown option: $1"
                show_usage
                exit 1
                ;;
            *)
                SERVICES_TO_BUILD+=("$1")
                shift
                ;;
        esac
    done
    
    # Set default tag
    if [[ -z "$CUSTOM_TAG" ]]; then
        CUSTOM_TAG="$DEFAULT_TAG"
    fi
    
    # Start build process
    log "INFO" "Starting GoMeet Docker build process"
    log "INFO" "Build ID: $BUILD_ID"
    log "INFO" "Registry: $REGISTRY"
    log "INFO" "Tag: $CUSTOM_TAG"
    log "INFO" "Log file: $LOG_FILE"
    
    # Set up cleanup
    trap cleanup EXIT
    
    # Run build phases
    check_prerequisites
    setup_buildkit
    login_to_registry
    build_images
    generate_build_report
    
    log "SUCCESS" "GoMeet Docker build process completed!"
    log "INFO" "Total build time: $(($(date +%s) - $(stat -c %Y "$LOG_FILE"))) seconds"
}

# Run main function with all arguments
main "$@"