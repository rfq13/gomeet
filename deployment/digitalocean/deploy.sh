#!/bin/bash

# GoMeet DigitalOcean Deployment Script
# Script untuk deployment konfigurasi GoMeet ke DigitalOcean Kubernetes Engine

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="gomeet"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/gomeet-do-deployment-$(date +%Y%m%d-%H%M%S).log"

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

check_prerequisites() {
    log "Memeriksa prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl tidak terinstall. Silakan install kubectl terlebih dahulu."
        exit 1
    fi
    
    # Check doctl
    if ! command -v doctl &> /dev/null; then
        log_error "doctl tidak terinstall. Silakan install doctl terlebih dahulu."
        exit 1
    fi
    
    # Check kubernetes connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Tidak dapat terhubung ke Kubernetes cluster. Periksa konfigurasi kubectl."
        exit 1
    fi
    
    # Check DigitalOcean authentication
    if ! doctl account get &> /dev/null; then
        log_error "Tidak dapat terhubung ke DigitalOcean. Periksa konfigurasi doctl."
        exit 1
    fi
    
    log_success "Semua prerequisites terpenuhi"
}

validate_secrets() {
    log "Memvalidasi secrets..."
    
    # Check if secrets exist
    if ! kubectl get secret gomeet-secrets -n "$NAMESPACE" &> /dev/null; then
        log_warning "Secret gomeet-secrets tidak ditemukan. Pastikan untuk membuat secrets terlebih dahulu."
        log "Jalankan: kubectl apply -f secrets.yaml"
        log "Kemudian edit secrets dengan: kubectl edit secret gomeet-secrets -n $NAMESPACE"
        return 1
    fi
    
    if ! kubectl get secret digitalocean-credentials -n "$NAMESPACE" &> /dev/null; then
        log_warning "Secret digitalocean-credentials tidak ditemukan."
        return 1
    fi
    
    log_success "Secrets valid"
    return 0
}

validate_managed_services() {
    log "Memvalidasi managed services..."
    
    # Check PostgreSQL connection from secrets
    POSTGRES_HOST=$(kubectl get secret gomeet-secrets -n "$NAMESPACE" -o jsonpath='{.data.DO_POSTGRES_HOST}' | base64 -d 2>/dev/null || echo "")
    REDIS_HOST=$(kubectl get secret gomeet-secrets -n "$NAMESPACE" -o jsonpath='{.data.DO_REDIS_HOST}' | base64 -d 2>/dev/null || echo "")
    
    if [[ -z "$POSTGRES_HOST" ]]; then
        log_warning "DO_POSTGRES_HOST tidak dikonfigurasi dalam secrets"
    else
        log_success "PostgreSQL host: $POSTGRES_HOST"
    fi
    
    if [[ -z "$REDIS_HOST" ]]; then
        log_warning "DO_REDIS_HOST tidak dikonfigurasi dalam secrets"
    else
        log_success "Redis host: $REDIS_HOST"
    fi
}

deploy_infrastructure() {
    log "Deploy infrastructure components..."
    
    # Deploy namespace
    log "Membuat namespace..."
    kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
    
    # Deploy configmaps
    log "Membuat configmaps..."
    kubectl apply -f "$SCRIPT_DIR/configmaps.yaml"
    
    log_success "Infrastructure components deployed"
}

deploy_database() {
    log "Deploy database components..."
    
    # Deploy PostgreSQL configuration
    log "Konfigurasi PostgreSQL..."
    kubectl apply -f "$SCRIPT_DIR/postgres-config.yaml"
    
    # Deploy Redis configuration
    log "Konfigurasi Redis..."
    kubectl apply -f "$SCRIPT_DIR/redis-config.yaml"
    
    # Wait for database exporters to be ready
    log "Menunggu database exporters siap..."
    kubectl wait --for=condition=ready pod -l app=postgres-exporter -n "$NAMESPACE" --timeout=300s
    kubectl wait --for=condition=ready pod -l app=redis-exporter -n "$NAMESPACE" --timeout=300s
    
    log_success "Database components deployed"
}

deploy_services() {
    log "Deploy application services..."
    
    # Deploy API services
    log "Deploy API services..."
    kubectl apply -f "$SCRIPT_DIR/api-services.yaml"
    
    # Deploy LiveKit SFU
    log "Deploy LiveKit SFU..."
    kubectl apply -f "$SCRIPT_DIR/livekit-sfu.yaml"
    
    # Wait for core services to be ready
    log "Menunggu services siap..."
    kubectl wait --for=condition=ready pod -l app=auth-service -n "$NAMESPACE" --timeout=600s
    kubectl wait --for=condition=ready pod -l app=meeting-service -n "$NAMESPACE" --timeout=600s
    kubectl wait --for=condition=ready pod -l app=livekit-sfu -n "$NAMESPACE" --timeout=600s
    
    log_success "Application services deployed"
}

deploy_gateway() {
    log "Deploy gateway components..."
    
    # Deploy Traefik gateway
    log "Deploy Traefik gateway..."
    kubectl apply -f "$SCRIPT_DIR/traefik-gateway.yaml"
    
    # Wait for Traefik to be ready
    log "Menunggu Traefik siap..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=traefik -n "$NAMESPACE" --timeout=300s
    
    # Get Load Balancer IP
    log "Mendapatkan Load Balancer IP..."
    LB_IP=""
    for i in {1..30}; do
        LB_IP=$(kubectl get svc traefik -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        if [[ -n "$LB_IP" ]]; then
            break
        fi
        log "Menunggu Load Balancer IP... (attempt $i/30)"
        sleep 10
    done
    
    if [[ -n "$LB_IP" ]]; then
        log_success "Load Balancer IP: $LB_IP"
    else
        log_warning "Load Balancer IP belum tersedia. Periksa manual dengan: kubectl get svc traefik -n $NAMESPACE"
    fi
    
    log_success "Gateway components deployed"
}

deploy_networking() {
    log "Deploy networking components..."
    
    # Deploy ingress
    log "Deploy ingress configuration..."
    kubectl apply -f "$SCRIPT_DIR/ingress.yaml"
    
    # Deploy network policies
    log "Deploy network policies..."
    kubectl apply -f "$SCRIPT_DIR/network-policies.yaml"
    
    log_success "Networking components deployed"
}

deploy_monitoring() {
    log "Deploy monitoring components..."
    
    # Deploy monitoring stack
    log "Deploy monitoring stack..."
    kubectl apply -f "$SCRIPT_DIR/monitoring.yaml"
    
    # Wait for monitoring to be ready
    log "Menunggu monitoring stack siap..."
    kubectl wait --for=condition=ready pod -l app=prometheus -n "$NAMESPACE" --timeout=600s
    kubectl wait --for=condition=ready pod -l app=grafana -n "$NAMESPACE" --timeout=600s
    
    log_success "Monitoring components deployed"
}

deploy_scaling() {
    log "Deploy auto-scaling components..."
    
    # Deploy HPA
    log "Deploy Horizontal Pod Autoscaler..."
    kubectl apply -f "$SCRIPT_DIR/hpa.yaml"
    
    log_success "Auto-scaling components deployed"
}

validate_deployment() {
    log "Validasi deployment..."
    
    # Check pod status
    log "Memeriksa pod status..."
    kubectl get pods -n "$NAMESPACE" -o wide
    
    # Check services
    log "Memeriksa services..."
    kubectl get svc -n "$NAMESPACE"
    
    # Check HPA status
    log "Memeriksa HPA status..."
    kubectl get hpa -n "$NAMESPACE"
    
    # Check ingress
    log "Memeriksa ingress..."
    kubectl get ingress -n "$NAMESPACE"
    
    # Basic connectivity test
    log "Melakukan connectivity test..."
    
    # Test auth service
    AUTH_SVC_IP=$(kubectl get svc auth-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    if [[ -n "$AUTH_SVC_IP" ]]; then
        if kubectl run test-pod --image=curlimages/curl --rm -i --restart=Never -- curl -f -s "http://$AUTH_SVC_IP:8080/health" &> /dev/null; then
            log_success "Auth service health check passed"
        else
            log_warning "Auth service health check failed"
        fi
    fi
    
    log_success "Deployment validation completed"
}

show_next_steps() {
    log "Deployment completed! Next steps:"
    echo ""
    echo "1. Setup DNS records:"
    echo "   - Point your domains to the Load Balancer IP"
    echo "   - Configure SSL certificates"
    echo ""
    echo "2. Access services:"
    echo "   - Grafana: kubectl port-forward svc/grafana 3000:3000 -n $NAMESPACE"
    echo "   - Prometheus: kubectl port-forward svc/prometheus 9090:9090 -n $NAMESPACE"
    echo "   - Traefik Dashboard: kubectl port-forward svc/traefik 8080:8080 -n $NAMESPACE"
    echo ""
    echo "3. Monitor deployment:"
    echo "   - kubectl get pods -n $NAMESPACE -w"
    echo "   - kubectl get hpa -n $NAMESPACE -w"
    echo ""
    echo "4. Check logs:"
    echo "   - kubectl logs -f deployment/auth-service -n $NAMESPACE"
    echo "   - kubectl logs -f deployment/livekit-sfu -n $NAMESPACE"
    echo ""
    echo "5. For troubleshooting, see: $LOG_FILE"
}

cleanup_on_error() {
    log_error "Deployment failed. Cleaning up..."
    
    # Optional: Uncomment to clean up on error
    # log "Rolling back deployment..."
    # kubectl delete namespace "$NAMESPACE" --ignore-not-found=true
    
    log "Deployment log saved to: $LOG_FILE"
    exit 1
}

# Main execution
main() {
    log "Starting GoMeet DigitalOcean deployment..."
    log "Deployment log: $LOG_FILE"
    
    # Set error handling
    trap cleanup_on_error ERR
    
    # Check prerequisites
    check_prerequisites
    
    # Validate secrets (optional, will warn if not configured)
    validate_secrets || true
    
    # Validate managed services configuration
    validate_managed_services
    
    # Deploy in phases
    deploy_infrastructure
    deploy_database
    deploy_services
    deploy_gateway
    deploy_networking
    deploy_monitoring
    deploy_scaling
    
    # Validate deployment
    validate_deployment
    
    # Show next steps
    show_next_steps
    
    log_success "GoMeet DigitalOcean deployment completed successfully!"
}

# Script usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -v, --verbose  Enable verbose logging"
    echo "  -n, --namespace NAMESPACE  Override namespace (default: gomeet)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Deploy with default settings"
    echo "  $0 -n staging         # Deploy to staging namespace"
    echo "  $0 -v                 # Deploy with verbose logging"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -v|--verbose)
            set -x
            shift
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Run main function
main "$@"