#!/bin/bash

# GoMeet DigitalOcean Master Deployment Script
# Script master untuk deployment otomatis lengkap GoMeet di DigitalOcean
# Target: 500 partisipan per meeting, 50,000 concurrent participants
# Estimasi biaya: $27,048/bulan

set -uo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="gomeet"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="/tmp/gomeet-deployment"
LOG_FILE="$LOG_DIR/master-deploy-$(date +%Y%m%d-%H%M%S).log"
DEPLOYMENT_ID="gomeet-$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$LOG_DIR/backup-$DEPLOYMENT_ID"

# Deployment phases
PHASES=(
    "prerequisites"
    "infrastructure"
    "secrets"
    "images"
    "database"
    "services"
    "gateway"
    "monitoring"
    "scaling"
    "validation"
    "post-deploy"
)

# Global variables
VERBOSE=false
DRY_RUN=false
SKIP_BUILD=false
SKIP_SECRETS=false
FORCE_DEPLOY=false
ROLLBACK_ENABLED=true
ENVIRONMENT="production"
REGION="nyc1"
CLUSTER_NAME=""
REGISTRY_NAME="gomeet"

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

# Error handling and rollback
handle_error() {
    local exit_code=$?
    local line_number=$1
    
    log "ERROR" "Deployment failed at line $line_number with exit code $exit_code"
    
    if [[ "$ROLLBACK_ENABLED" == true ]]; then
        log "WARNING" "Initiating automatic rollback..."
        rollback_deployment
    fi
    
    log "ERROR" "Deployment failed. Check logs: $LOG_FILE"
    exit $exit_code
}

# Set up error handling
trap 'handle_error $LINENO' ERR
trap 'log "INFO" "Deployment interrupted. Cleaning up..."; cleanup_on_exit' INT TERM

# Cleanup function
cleanup_on_exit() {
    log "INFO" "Performing cleanup..."
    
    # Kill any background processes
    jobs -p | xargs -r kill
    
    # Cleanup temporary files
    find /tmp -name "gomeet-*" -type f -mtime +1 -delete 2>/dev/null || true
    
    log "INFO" "Cleanup completed"
}

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    local tools=("kubectl" "doctl" "docker" "git" "openssl")
    local missing_tools=()
    
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log "ERROR" "Missing required tools: ${missing_tools[*]}"
        log "INFO" "Please install missing tools and try again"
        exit 1
    fi
    
    # Check kubernetes connection
    if ! kubectl cluster-info &> /dev/null; then
        log "ERROR" "Cannot connect to Kubernetes cluster"
        log "INFO" "Please check your kubectl configuration"
        exit 1
    fi
    
    # Check DigitalOcean authentication
    if ! doctl account get &> /dev/null; then
        log "ERROR" "Cannot authenticate with DigitalOcean"
        log "INFO" "Please run: doctl auth init"
        exit 1
    fi
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log "ERROR" "Docker daemon is not running"
        exit 1
    fi
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    log "SUCCESS" "All prerequisites satisfied"
}

# Infrastructure setup
setup_infrastructure() {
    log "PHASE" "Setting Up Infrastructure"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would set up DigitalOcean infrastructure"
        return 0
    fi
    
    # Get or create cluster info
    if [[ -z "$CLUSTER_NAME" ]]; then
        CLUSTER_NAME=$(kubectl config current-context | sed 's/.*-//' || echo "gomeet-cluster")
    fi
    
    log "INFO" "Using cluster: $CLUSTER_NAME"
    log "INFO" "Region: $REGION"
    
    # Create namespace
    log "INFO" "Creating namespace: $NAMESPACE"
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Apply infrastructure manifests
    local manifests=(
        "namespace.yaml"
        "configmaps.yaml"
        "network-policies.yaml"
    )
    
    for manifest in "${manifests[@]}"; do
        if [[ -f "$SCRIPT_DIR/$manifest" ]]; then
            log "INFO" "Applying $manifest"
            kubectl apply -f "$SCRIPT_DIR/$manifest" --record
        else
            log "WARNING" "Manifest not found: $manifest"
        fi
    done
    
    log "SUCCESS" "Infrastructure setup completed"
}

# Secrets management
setup_secrets() {
    log "PHASE" "Setting Up Secrets"
    
    if [[ "$SKIP_SECRETS" == true ]]; then
        log "INFO" "Skipping secrets setup"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would set up secrets"
        return 0
    fi
    
    # Check if secrets already exist
    if kubectl get secret gomeet-secrets -n "$NAMESPACE" &> /dev/null; then
        if [[ "$FORCE_DEPLOY" == false ]]; then
            log "WARNING" "Secrets already exist. Use --force to overwrite"
            return 0
        fi
        log "INFO" "Updating existing secrets"
    fi
    
    # Run secrets setup script
    if [[ -f "$SCRIPT_DIR/setup-secrets.sh" ]]; then
        log "INFO" "Running secrets setup script"
        bash "$SCRIPT_DIR/setup-secrets.sh" -n "$NAMESPACE"
    else
        log "ERROR" "Secrets setup script not found"
        exit 1
    fi
    
    log "SUCCESS" "Secrets setup completed"
}

# Build and push Docker images
build_and_push_images() {
    log "PHASE" "Building and Pushing Docker Images"
    
    if [[ "$SKIP_BUILD" == true ]]; then
        log "INFO" "Skipping image build"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would build and push images"
        return 0
    fi
    
    # Run build script
    if [[ -f "$SCRIPT_DIR/build-images.sh" ]]; then
        log "INFO" "Running image build script"
        bash "$SCRIPT_DIR/build-images.sh" --registry "$REGISTRY_NAME" --tag "$DEPLOYMENT_ID"
    else
        log "ERROR" "Image build script not found"
        exit 1
    fi
    
    log "SUCCESS" "Images built and pushed"
}

# Database setup
setup_database() {
    log "PHASE" "Setting Up Database"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would set up database"
        return 0
    fi
    
    # Apply database configurations
    local manifests=(
        "postgres-config.yaml"
        "redis-config.yaml"
    )
    
    for manifest in "${manifests[@]}"; do
        if [[ -f "$SCRIPT_DIR/$manifest" ]]; then
            log "INFO" "Applying $manifest"
            kubectl apply -f "$SCRIPT_DIR/$manifest" --record
        fi
    done
    
    # Wait for database components to be ready
    log "INFO" "Waiting for database components to be ready"
    kubectl wait --for=condition=ready pod -l app=postgres-exporter -n "$NAMESPACE" --timeout=300s
    kubectl wait --for=condition=ready pod -l app=redis-exporter -n "$NAMESPACE" --timeout=300s
    kubectl wait --for=condition=ready pod -l app=pgbouncer -n "$NAMESPACE" --timeout=300s
    
    log "SUCCESS" "Database setup completed"
}

# Deploy application services
deploy_services() {
    log "PHASE" "Deploying Application Services"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would deploy services"
        return 0
    fi
    
    # Update image tags in manifests
    log "INFO" "Updating image tags to $DEPLOYMENT_ID"
    
    # Apply service manifests
    local manifests=(
        "api-services.yaml"
        "livekit-sfu.yaml"
    )
    
    for manifest in "${manifests[@]}"; do
        if [[ -f "$SCRIPT_DIR/$manifest" ]]; then
            log "INFO" "Applying $manifest"
            # Update image tags and apply
            sed "s/:latest/:$DEPLOYMENT_ID/g" "$SCRIPT_DIR/$manifest" | kubectl apply -f - --record
        fi
    done
    
    # Wait for core services to be ready
    log "INFO" "Waiting for services to be ready"
    local services=(
        "auth-service"
        "meeting-service"
        "signaling-service"
        "chat-service"
        "turn-service"
        "livekit-sfu"
    )
    
    for service in "${services[@]}"; do
        log "INFO" "Waiting for $service to be ready"
        kubectl wait --for=condition=available deployment/$service -n "$NAMESPACE" --timeout=600s
    done
    
    log "SUCCESS" "Services deployed"
}

# Deploy gateway
deploy_gateway() {
    log "PHASE" "Deploying Gateway"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would deploy gateway"
        return 0
    fi
    
    # Apply gateway manifests
    local manifests=(
        "traefik-gateway.yaml"
        "ingress.yaml"
    )
    
    for manifest in "${manifests[@]}"; do
        if [[ -f "$SCRIPT_DIR/$manifest" ]]; then
            log "INFO" "Applying $manifest"
            sed "s/:latest/:$DEPLOYMENT_ID/g" "$SCRIPT_DIR/$manifest" | kubectl apply -f - --record
        fi
    done
    
    # Wait for Traefik to be ready
    log "INFO" "Waiting for Traefik to be ready"
    kubectl wait --for=condition=available deployment/traefik -n "$NAMESPACE" --timeout=300s
    
    # Get Load Balancer IP
    log "INFO" "Getting Load Balancer IP"
    local lb_ip=""
    for i in {1..30}; do
        lb_ip=$(kubectl get svc traefik -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        if [[ -n "$lb_ip" ]]; then
            break
        fi
        sleep 10
        show_progress $i 30 "Waiting for Load Balancer IP"
    done
    
    if [[ -n "$lb_ip" ]]; then
        log "SUCCESS" "Load Balancer IP: $lb_ip"
        echo "$lb_ip" > "$LOG_DIR/lb-ip.txt"
    else
        log "WARNING" "Load Balancer IP not available"
    fi
    
    log "SUCCESS" "Gateway deployed"
}

# Deploy monitoring
deploy_monitoring() {
    log "PHASE" "Deploying Monitoring"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would deploy monitoring"
        return 0
    fi
    
    # Apply monitoring manifests
    if [[ -f "$SCRIPT_DIR/monitoring.yaml" ]]; then
        log "INFO" "Applying monitoring.yaml"
        sed "s/:latest/:$DEPLOYMENT_ID/g" "$SCRIPT_DIR/monitoring.yaml" | kubectl apply -f - --record
    fi
    
    # Wait for monitoring to be ready
    log "INFO" "Waiting for monitoring stack"
    kubectl wait --for=condition=available deployment/prometheus -n "$NAMESPACE" --timeout=600s
    kubectl wait --for=condition=available deployment/grafana -n "$NAMESPACE" --timeout=600s
    
    log "SUCCESS" "Monitoring deployed"
}

# Setup auto-scaling
setup_scaling() {
    log "PHASE" "Setting Up Auto-Scaling"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would set up auto-scaling"
        return 0
    fi
    
    # Apply HPA manifests
    if [[ -f "$SCRIPT_DIR/hpa.yaml" ]]; then
        log "INFO" "Applying HPA configuration"
        kubectl apply -f "$SCRIPT_DIR/hpa.yaml" --record
    fi
    
    log "SUCCESS" "Auto-scaling configured"
}

# Validate deployment
validate_deployment() {
    log "PHASE" "Validating Deployment"
    
    log "INFO" "Checking pod status"
    kubectl get pods -n "$NAMESPACE" -o wide
    
    log "INFO" "Checking services"
    kubectl get services -n "$NAMESPACE"
    
    log "INFO" "Checking HPA status"
    kubectl get hpa -n "$NAMESPACE"
    
    log "INFO" "Running health checks"
    if [[ -f "$SCRIPT_DIR/health-check.sh" ]]; then
        bash "$SCRIPT_DIR/health-check.sh" --namespace "$NAMESPACE"
    fi
    
    # Basic connectivity tests
    log "INFO" "Performing connectivity tests"
    
    local auth_svc_ip=$(kubectl get svc auth-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
    if [[ -n "$auth_svc_ip" ]]; then
        if kubectl run test-pod --image=curlimages/curl --rm -i --restart=Never -- curl -f -s "http://$auth_svc_ip:8080/health" &> /dev/null; then
            log "SUCCESS" "Auth service health check passed"
        else
            log "WARNING" "Auth service health check failed"
        fi
    fi
    
    log "SUCCESS" "Deployment validation completed"
}

# Post-deployment tasks
post_deployment() {
    log "PHASE" "Post-Deployment Tasks"
    
    # Create deployment snapshot
    log "INFO" "Creating deployment snapshot"
    kubectl get all -n "$NAMESPACE" -o yaml > "$LOG_DIR/deployment-snapshot-$DEPLOYMENT_ID.yaml"
    
    # Set up cost monitoring
    if [[ -f "$SCRIPT_DIR/cost-monitor.sh" ]]; then
        log "INFO" "Setting up cost monitoring"
        bash "$SCRIPT_DIR/cost-monitor.sh" --setup --namespace "$NAMESPACE"
    fi
    
    # Display access information
    show_access_info
    
    log "SUCCESS" "Post-deployment tasks completed"
}

# Show access information
show_access_info() {
    local lb_ip=""
    if [[ -f "$LOG_DIR/lb-ip.txt" ]]; then
        lb_ip=$(cat "$LOG_DIR/lb-ip.txt")
    fi
    
    log "INFO" "Deployment completed successfully!"
    echo ""
    echo "🚀 GoMeet Deployment Information:"
    echo "=================================="
    echo "Deployment ID: $DEPLOYMENT_ID"
    echo "Namespace: $NAMESPACE"
    echo "Environment: $ENVIRONMENT"
    echo "Region: $REGION"
    
    if [[ -n "$lb_ip" ]]; then
        echo "Load Balancer IP: $lb_ip"
        echo ""
        echo "📋 Next Steps:"
        echo "1. Update DNS records to point to $lb_ip"
        echo "2. Configure SSL certificates"
        echo "3. Update environment variables if needed"
    fi
    
    echo ""
    echo "🔧 Access Services:"
    echo "- Grafana: kubectl port-forward svc/grafana 3000:3000 -n $NAMESPACE"
    echo "- Prometheus: kubectl port-forward svc/prometheus 9090:9090 -n $NAMESPACE"
    echo "- Traefik Dashboard: kubectl port-forward svc/traefik 8080:8080 -n $NAMESPACE"
    
    echo ""
    echo "📊 Monitoring Commands:"
    echo "- Watch pods: kubectl get pods -n $NAMESPACE -w"
    echo "- Watch HPA: kubectl get hpa -n $NAMESPACE -w"
    echo "- Check logs: kubectl logs -f deployment/<service-name> -n $NAMESPACE"
    
    echo ""
    echo "📁 Important Files:"
    echo "- Deployment log: $LOG_FILE"
    echo "- Deployment snapshot: $LOG_DIR/deployment-snapshot-$DEPLOYMENT_ID.yaml"
    echo "- Backup directory: $BACKUP_DIR"
    
    echo ""
    echo "⚠️  Production Checklist:"
    echo "□ DNS records configured"
    echo "□ SSL certificates installed"
    echo "□ Monitoring alerts configured"
    echo "□ Backup schedules set"
    echo "□ Security scan completed"
    echo "□ Performance testing done"
}

# Rollback function
rollback_deployment() {
    log "WARNING" "Starting deployment rollback..."
    
    # Get previous deployment info
    local previous_deployment=$(kubectl get deployments -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.annotations.deployment\.kubernetes\.io/revision}' 2>/dev/null || echo "")
    
    if [[ -n "$previous_deployment" && "$previous_deployment" != "1" ]]; then
        log "INFO" "Rolling back to revision $previous_deployment"
        
        # Rollback each deployment
        local deployments=(
            "auth-service"
            "meeting-service"
            "signaling-service"
            "chat-service"
            "turn-service"
            "livekit-sfu"
            "traefik"
            "prometheus"
            "grafana"
        )
        
        for deployment in "${deployments[@]}"; do
            if kubectl get deployment "$deployment" -n "$NAMESPACE" &> /dev/null; then
                log "INFO" "Rolling back $deployment"
                kubectl rollout undo deployment/"$deployment" -n "$NAMESPACE" || true
            fi
        done
        
        log "SUCCESS" "Rollback initiated"
    else
        log "WARNING" "No previous deployment found for rollback"
    fi
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Master Deployment Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help                    Show this help message"
    echo "  -v, --verbose                 Enable verbose logging"
    echo "  -n, --namespace NAMESPACE     Override namespace (default: gomeet)"
    echo "  -e, --environment ENV         Environment (default: production)"
    echo "  -r, --region REGION           DigitalOcean region (default: nyc1)"
    echo "  -c, --cluster CLUSTER         Kubernetes cluster name"
    echo "  --dry-run                     Simulate deployment without making changes"
    echo "  --skip-build                  Skip Docker image build"
    echo "  --skip-secrets                Skip secrets setup"
    echo "  --force                       Force deployment (overwrite existing)"
    echo "  --no-rollback                 Disable automatic rollback on failure"
    echo "  --phase PHASE                 Run specific phase only"
    echo ""
    echo "Available phases:"
    for phase in "${PHASES[@]}"; do
        echo "  - $phase"
    done
    echo ""
    echo "Examples:"
    echo "  $0                           # Full deployment"
    echo "  $0 --dry-run                 # Simulate deployment"
    echo "  $0 --phase infrastructure     # Run only infrastructure phase"
    echo "  $0 --skip-build --force       # Skip build and force deploy"
    echo "  $0 -n staging -e staging      # Deploy to staging environment"
}

# Main execution function
main() {
    local target_phase=""
    
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
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -r|--region)
                REGION="$2"
                shift 2
                ;;
            -c|--cluster)
                CLUSTER_NAME="$2"
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
            --skip-secrets)
                SKIP_SECRETS=true
                shift
                ;;
            --force)
                FORCE_DEPLOY=true
                shift
                ;;
            --no-rollback)
                ROLLBACK_ENABLED=false
                shift
                ;;
            --phase)
                target_phase="$2"
                shift 2
                ;;
            *)
                log "ERROR" "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Start deployment
    log "INFO" "Starting GoMeet DigitalOcean deployment"
    log "INFO" "Deployment ID: $DEPLOYMENT_ID"
    log "INFO" "Log file: $LOG_FILE"
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    
    # Run phases
    local phases_to_run=("${PHASES[@]}")
    if [[ -n "$target_phase" ]]; then
        if [[ " ${PHASES[*]} " =~ " $target_phase " ]]; then
            phases_to_run=("$target_phase")
        else
            log "ERROR" "Invalid phase: $target_phase"
            log "INFO" "Available phases: ${PHASES[*]}"
            exit 1
        fi
    fi
    
    local total_phases=${#phases_to_run[@]}
    local current_phase=0
    
    for phase in "${phases_to_run[@]}"; do
        ((current_phase++))
        show_progress $current_phase $total_phases "Running phase: $phase"
        
        case "$phase" in
            "prerequisites") check_prerequisites ;;
            "infrastructure") setup_infrastructure ;;
            "secrets") setup_secrets ;;
            "images") build_and_push_images ;;
            "database") setup_database ;;
            "services") deploy_services ;;
            "gateway") deploy_gateway ;;
            "monitoring") deploy_monitoring ;;
            "scaling") setup_scaling ;;
            "validation") validate_deployment ;;
            "post-deploy") post_deployment ;;
        esac
    done
    
    log "SUCCESS" "GoMeet DigitalOcean deployment completed successfully!"
    log "INFO" "Total deployment time: $(($(date +%s) - $(stat -c %Y "$LOG_FILE"))) seconds"
}

# Run main function with all arguments
main "$@"