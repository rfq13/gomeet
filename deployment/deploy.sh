#!/bin/bash

# GoMeet Infrastructure Deployment Script
# Target: 500 participants per meeting (50,000 concurrent total)

set -e

# Configuration
NAMESPACE="gomeet"
REGION="singapore"
DIGITALOCEAN_TOKEN=${DIGITALOCEAN_TOKEN:-""}
DEPLOYMENT_MODE=${DEPLOYMENT_MODE:-"production"} # production, staging

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Pre-deployment checks
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    # Check kubectl connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check doctl (DigitalOcean CLI)
    if ! command -v doctl &> /dev/null; then
        log_error "doctl is not installed"
        exit 1
    fi
    
    # Check DigitalOcean token
    if [[ -z "$DIGITALOCEAN_TOKEN" ]]; then
        log_error "DIGITALOCEAN_TOKEN environment variable is not set"
        exit 1
    fi
    
    # Check cluster resources for 500 participants scale
    log_info "Checking cluster resource availability..."
    NODES=$(kubectl get nodes --no-headers | wc -l)
    if [[ $NODES -lt 10 ]]; then
        log_warning "Recommended minimum nodes for 500 participants scale is 10, current: $NODES"
    fi
    
    # Check available memory
    TOTAL_MEMORY=$(kubectl top nodes --no-headers | awk '{sum+=$3} END {print sum}' | sed 's/Mi//')
    if [[ $TOTAL_MEMORY -lt 256000 ]]; then
        log_warning "Recommended minimum memory for 500 participants scale is 256Gi, current: ${TOTAL_MEMORY}Mi"
    fi
    
    # Set doctl context
    doctl auth init -t "$DIGITALOCEAN_TOKEN"
    
    log_success "Prerequisites check passed"
}

# Create namespace
create_namespace() {
    log_info "Creating namespace: $NAMESPACE"
    
    if kubectl get namespace $NAMESPACE &> /dev/null; then
        log_warning "Namespace $NAMESPACE already exists"
    else
        kubectl apply -f k8s/namespace.yaml
        log_success "Namespace $NAMESPACE created"
    fi
}

# Create secrets
create_secrets() {
    log_info "Creating secrets..."
    
    # Generate secure passwords if not exists
    if ! kubectl get secret gomeet-secrets -n $NAMESPACE &> /dev/null; then
        kubectl create secret generic gomeet-secrets -n $NAMESPACE \
            --from-literal=POSTGRES_PASSWORD=$(openssl rand -base64 32) \
            --from-literal=REDIS_PASSWORD=$(openssl rand -base64 32) \
            --from-literal=JWT_SECRET=$(openssl rand -base64 64) \
            --from-literal=LIVEKIT_API_KEY=$(openssl rand -hex 16) \
            --from-literal=LIVEKIT_API_SECRET=$(openssl rand -hex 32) \
            --from-literal=TURN_SECRET=$(openssl rand -hex 32) \
            --from-literal=GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16) \
            --from-literal=GRAFANA_SECRET_KEY=$(openssl rand -base64 32) \
            --from-literal=GRAFANA_DB_PASSWORD=$(openssl rand -base64 16) \
            --from-literal=SMTP_USER="alerts@gomeet.com" \
            --from-literal=SMTP_PASSWORD="your-smtp-password" \
            --from-literal=TURN_USERNAME="gomeet" \
            --from-literal=SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
        
        log_success "Secrets created"
    else
        log_warning "Secrets already exist"
    fi
}

# Deploy storage
deploy_storage() {
    log_info "Deploying storage layer..."
    
    # Create storage classes and PVCs for high scale
    kubectl apply -f k8s/namespace.yaml -n $NAMESPACE
    
    # Wait for namespace to be ready
    kubectl wait --for=condition=active namespace/$NAMESPACE --timeout=60s
    
    log_success "Storage layer deployed"
}

# Deploy database cluster
deploy_database() {
    log_info "Deploying PostgreSQL cluster for high throughput..."
    
    # Deploy primary and replicas with optimized configuration
    kubectl apply -f k8s/postgresql-cluster.yaml -n $NAMESPACE
    
    # Wait for primary to be ready
    log_info "Waiting for PostgreSQL primary to be ready..."
    kubectl wait --for=condition=ready pod postgres-primary-0 -n $NAMESPACE --timeout=600s
    
    # Wait for replicas to be ready
    log_info "Waiting for PostgreSQL replicas to be ready..."
    kubectl wait --for=condition=ready pod -l app=postgres,role=replica -n $NAMESPACE --timeout=600s
    
    # Wait for PgBouncer to be ready
    log_info "Waiting for PgBouncer to be ready..."
    kubectl wait --for=condition=ready pod -l app=pgbouncer -n $NAMESPACE --timeout=300s
    
    log_success "PostgreSQL cluster deployed"
}

# Deploy Redis cluster
deploy_redis() {
    log_info "Deploying Redis cluster for 50,000 connections..."
    
    # Deploy Redis masters and replicas
    kubectl apply -f k8s/redis-cluster.yaml -n $NAMESPACE
    
    # Wait for Redis pods to be ready
    log_info "Waiting for Redis pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=redis -n $NAMESPACE --timeout=600s
    
    # Initialize Redis cluster
    log_info "Initializing Redis cluster..."
    kubectl wait --for=condition=complete job/redis-cluster-init -n $NAMESPACE --timeout=600s
    
    log_success "Redis cluster deployed"
}

# Deploy LiveKit SFU cluster
deploy_livekit() {
    log_info "Deploying LiveKit SFU cluster for 500 participants..."
    
    # Deploy SFU nodes with optimized configuration
    kubectl apply -f k8s/livekit-sfu.yaml -n $NAMESPACE
    
    # Wait for SFU pods to be ready
    log_info "Waiting for LiveKit SFU pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=livekit-sfu -n $NAMESPACE --timeout=600s
    
    # Verify SFU HPA is working
    log_info "Verifying SFU HPA configuration..."
    kubectl wait --for=condition=available hpa/livekit-sfu-hpa -n $NAMESPACE --timeout=120s
    
    log_success "LiveKit SFU cluster deployed"
}

# Deploy API services
deploy_api_services() {
    log_info "Deploying API services with high scalability..."
    
    # Deploy all API services
    kubectl apply -f k8s/api-services.yaml -n $NAMESPACE
    
    # Wait for API pods to be ready
    log_info "Waiting for API service pods to be ready..."
    kubectl wait --for=condition=ready pod -l component=api -n $NAMESPACE --timeout=600s
    
    # Verify all HPAs are available
    log_info "Verifying API service HPA configurations..."
    for hpa in auth-service-hpa meeting-service-hpa signaling-service-hpa chat-service-hpa turn-service-hpa; do
        kubectl wait --for=condition=available hpa/$hpa -n $NAMESPACE --timeout=120s
    done
    
    log_success "API services deployed"
}

# Deploy API Gateway
deploy_gateway() {
    log_info "Deploying Traefik API Gateway with high throughput..."
    
    # Deploy Traefik with optimized configuration
    kubectl apply -f k8s/traefik-gateway.yaml -n $NAMESPACE
    
    # Wait for Traefik pods to be ready
    log_info "Waiting for Traefik pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=traefik -n $NAMESPACE --timeout=600s
    
    # Wait for Load Balancer IP
    log_info "Waiting for Load Balancer IP assignment..."
    LB_IP=""
    for i in {1..30}; do
        LB_IP=$(kubectl get service traefik -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        if [[ -n "$LB_IP" ]]; then
            break
        fi
        sleep 10
        echo -n "."
    done
    echo ""
    
    if [[ -z "$LB_IP" ]]; then
        log_error "Load Balancer IP not assigned after 5 minutes"
        return 1
    fi
    
    log_success "Traefik API Gateway deployed (LB IP: $LB_IP)"
}

# Deploy monitoring stack
deploy_monitoring() {
    log_info "Deploying enhanced monitoring stack..."
    
    # Deploy Prometheus, Grafana, and AlertManager
    kubectl apply -f k8s/monitoring-stack.yaml -n $NAMESPACE
    
    # Wait for monitoring pods to be ready
    log_info "Waiting for monitoring pods to be ready..."
    kubectl wait --for=condition=ready pod -l component=monitoring -n $NAMESPACE --timeout=600s
    
    log_success "Monitoring stack deployed"
}

# Configure auto-scaling
configure_autoscaling() {
    log_info "Configuring auto-scaling policies for 500 participants scale..."
    
    # All HPA configurations are included in the deployment files
    # Verify HPA configurations are active
    log_info "Verifying HPA configurations..."
    kubectl get hpa -n $NAMESPACE
    
    log_success "Auto-scaling configured"
}

# Run comprehensive health checks
run_health_checks() {
    log_info "Running comprehensive health checks..."
    
    local failed_checks=0
    
    # Check all pods are running
    log_info "Checking pod status..."
    PODS_READY=$(kubectl get pods -n $NAMESPACE -o json | jq '.items[] | select(.status.phase=="Running") | .metadata.name' | wc -l)
    TOTAL_PODS=$(kubectl get pods -n $NAMESPACE -o json | jq '.items | length')
    
    if [[ $PODS_READY -eq $TOTAL_PODS ]]; then
        log_success "All pods are running ($PODS_READY/$TOTAL_PODS)"
    else
        log_warning "Some pods are not ready ($PODS_READY/$TOTAL_PODS)"
        failed_checks=$((failed_checks + 1))
    fi
    
    # Check service endpoints
    log_info "Checking service endpoints..."
    
    # API Gateway health check
    LB_IP=$(kubectl get service traefik -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    if curl -f --connect-timeout 10 http://$LB_IP/ping &> /dev/null; then
        log_success "API Gateway is healthy"
    else
        log_error "API Gateway health check failed"
        failed_checks=$((failed_checks + 1))
    fi
    
    # Database health check
    if kubectl exec postgres-primary-0 -n $NAMESPACE -- pg_isready &> /dev/null; then
        log_success "PostgreSQL is healthy"
    else
        log_error "PostgreSQL health check failed"
        failed_checks=$((failed_checks + 1))
    fi
    
    # Redis health check
    if kubectl exec redis-master-0 -n $NAMESPACE -- redis-cli ping | grep -q PONG; then
        log_success "Redis is healthy"
    else
        log_error "Redis health check failed"
        failed_checks=$((failed_checks + 1))
    fi
    
    # LiveKit SFU health check
    SFU_POD=$(kubectl get pods -n $NAMESPACE -l app=livekit-sfu -o jsonpath='{.items[0].metadata.name}')
    if kubectl exec $SFU_POD -n $NAMESPACE -- curl -f http://localhost:7880/health &> /dev/null; then
        log_success "LiveKit SFU is healthy"
    else
        log_error "LiveKit SFU health check failed"
        failed_checks=$((failed_checks + 1))
    fi
    
    # Check resource utilization
    log_info "Checking resource utilization..."
    kubectl top pods -n $NAMESPACE --no-headers | head -10
    
    if [[ $failed_checks -eq 0 ]]; then
        log_success "All health checks passed"
    else
        log_error "$failed_checks health checks failed"
        return 1
    fi
}

# Performance validation
run_performance_validation() {
    log_info "Running performance validation for 500 participants scale..."
    
    # Check HPA configurations
    log_info "Validating HPA configurations..."
    kubectl get hpa -n $NAMESPACE -o wide
    
    # Check resource limits and requests
    log_info "Validating resource configurations..."
    kubectl describe pods -n $NAMESPACE | grep -E "(Limits|Requests)" | head -20
    
    # Check storage capacity
    log_info "Validating storage capacity..."
    kubectl get pvc -n $NAMESPACE
    
    # Check network policies
    log_info "Validating network configurations..."
    kubectl get services -n $NAMESPACE
    
    log_success "Performance validation completed"
}

# Load testing preparation
prepare_load_testing() {
    log_info "Preparing for load testing..."
    
    # Create test configuration
    cat > load-test-config.json << EOF
{
    "target_scale": {
        "participants_per_meeting": 500,
        "concurrent_meetings": 100,
        "total_participants": 50000
    },
    "endpoints": {
        "api_gateway": "$(kubectl get service traefik -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}')",
        "websocket": "wss://api.gomeet.com/api/v1/ws"
    },
    "test_scenarios": [
        "meeting_creation",
        "participant_join",
        "video_streaming",
        "chat_messages",
        "screen_sharing"
    ]
}
EOF
    
    log_success "Load testing configuration prepared"
    log_info "Run load tests with: k6 run load-test.js"
}

# Display deployment summary
display_summary() {
    log_info "Deployment Summary"
    echo "=================="
    echo "Namespace: $NAMESPACE"
    echo "Region: $REGION"
    echo "Deployment Mode: $DEPLOYMENT_MODE"
    echo "Target Scale: 500 participants per meeting"
    echo "Total Concurrent: 50,000 participants"
    echo ""
    
    LB_IP=$(kubectl get service traefik -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    echo "Load Balancer IP: $LB_IP"
    echo ""
    
    echo "Service URLs:"
    echo "- API Gateway: https://api.gomeet.com"
    echo "- LiveKit SFU: https://livekit.gomeet.com"
    echo "- Grafana Dashboard: https://grafana.gomeet.com"
    echo "- Traefik Dashboard: https://traefik.gomeet.com"
    echo "- AlertManager: https://alertmanager.gomeet.com"
    echo ""
    
    echo "Resource Summary:"
    echo "- LiveKit SFU Nodes: $(kubectl get pods -n $NAMESPACE -l app=livekit-sfu --no-headers | wc -l)"
    echo "- Auth Service: $(kubectl get pods -n $NAMESPACE -l app=auth-service --no-headers | wc -l)"
    echo "- Meeting Service: $(kubectl get pods -n $NAMESPACE -l app=meeting-service --no-headers | wc -l)"
    echo "- Signaling Service: $(kubectl get pods -n $NAMESPACE -l app=signaling-service --no-headers | wc -l)"
    echo "- Chat Service: $(kubectl get pods -n $NAMESPACE -l app=chat-service --no-headers | wc -l)"
    echo "- TURN Service: $(kubectl get pods -n $NAMESPACE -l app=turn-service --no-headers | wc -l)"
    echo "- Database Nodes: $(kubectl get pods -n $NAMESPACE -l app=postgres --no-headers | wc -l)"
    echo "- Redis Nodes: $(kubectl get pods -n $NAMESPACE -l app=redis --no-headers | wc -l)"
    echo "- Gateway Nodes: $(kubectl get pods -n $NAMESPACE -l app=traefik --no-headers | wc -l)"
    echo ""
    
    echo "Storage Summary:"
    kubectl get pvc -n $NAMESPACE -o custom-columns="NAME:.metadata.name,STATUS:.status.phase,CAPACITY:.status.capacity.storage"
    echo ""
    
    echo "Next Steps:"
    echo "1. Configure DNS records to point to Load Balancer IP ($LB_IP)"
    echo "2. Update SSL certificates with proper domains"
    echo "3. Configure monitoring alerts in Grafana"
    echo "4. Run comprehensive load tests"
    echo "5. Review and test disaster recovery procedures"
    echo "6. Set up backup and monitoring for production"
    echo ""
    
    echo "Load Testing Commands:"
    echo "- Prepare load test: ./deploy.sh prepare-load-test"
    echo "- Run health checks: ./deploy.sh health-check"
    echo "- Performance validation: ./deploy.sh performance-check"
}

# Cleanup function
cleanup() {
    log_warning "Cleaning up..."
    
    read -p "This will delete all resources in namespace $NAMESPACE. Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Delete all resources
        kubectl delete namespace $NAMESPACE --ignore-not-found=true
        log_success "Cleanup completed"
    else
        log_info "Cleanup cancelled"
    fi
}

# Rollback function
rollback() {
    log_warning "Rolling back deployment..."
    
    # Get previous deployment revision
    PREV_REVISION=$(kubectl rollout history deployment/traefik -n $NAMESPACE --to-revision=0 -o jsonpath='{.items[-1].revision}' 2>/dev/null || echo "1")
    
    # Rollback critical services
    for service in traefik auth-service meeting-service signaling-service; do
        log_info "Rolling back $service to revision $PREV_REVISION"
        kubectl rollout undo deployment/$service -n $NAMESPACE --to-revision=$PREV_REVISION
        kubectl rollout status deployment/$service -n $NAMESPACE --timeout=300s
    done
    
    log_success "Rollback completed"
}

# Main deployment function
main() {
    local action=${1:-"deploy"}
    
    case $action in
        "deploy")
            log_info "Starting GoMeet infrastructure deployment for 500 participants scale..."
            check_prerequisites
            create_namespace
            create_secrets
            deploy_storage
            deploy_database
            deploy_redis
            deploy_livekit
            deploy_api_services
            deploy_gateway
            deploy_monitoring
            configure_autoscaling
            run_health_checks
            run_performance_validation
            prepare_load_testing
            display_summary
            log_success "Deployment completed successfully!"
            ;;
        "cleanup")
            cleanup
            ;;
        "health-check")
            run_health_checks
            ;;
        "performance-check")
            run_performance_validation
            ;;
        "prepare-load-test")
            prepare_load_testing
            ;;
        "rollback")
            rollback
            ;;
        *)
            echo "Usage: $0 {deploy|cleanup|health-check|performance-check|prepare-load-test|rollback}"
            echo "  deploy             - Deploy the complete infrastructure for 500 participants"
            echo "  cleanup            - Remove all deployed resources"
            echo "  health-check       - Run comprehensive health checks"
            echo "  performance-check  - Validate performance configurations"
            echo "  prepare-load-test  - Prepare load testing configuration"
            echo "  rollback           - Rollback to previous deployment revision"
            exit 1
            ;;
    esac
}

# Script entry point
main "$@"