#!/bin/bash

# GoMeet DigitalOcean Monitoring Script
# Script untuk monitoring dan maintenance cluster GoMeet

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

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

# Function to check cluster health
check_cluster_health() {
    log "Memeriksa kesehatan cluster..."
    
    # Check nodes
    log "Status nodes:"
    kubectl get nodes -o wide
    
    # Check namespace
    log "Status namespace:"
    kubectl get namespace "$NAMESPACE"
    
    # Check overall pod status
    log "Status pods:"
    kubectl get pods -n "$NAMESPACE" --show-labels
    
    # Check pod resource usage
    log "Resource usage:"
    kubectl top pods -n "$NAMESPACE" --sort-by=cpu 2>/dev/null || log_warning "Metrics server tidak tersedia"
    
    log_success "Cluster health check completed"
}

# Function to check services health
check_services_health() {
    log "Memeriksa kesehatan services..."
    
    # Check services
    log "Status services:"
    kubectl get svc -n "$NAMESPACE" -o wide
    
    # Check endpoints
    log "Status endpoints:"
    kubectl get endpoints -n "$NAMESPACE"
    
    # Check ingress
    log "Status ingress:"
    kubectl get ingress -n "$NAMESPACE"
    
    # Check HPA status
    log "Status HPA:"
    kubectl get hpa -n "$NAMESPACE"
    
    log_success "Services health check completed"
}

# Function to check application health
check_application_health() {
    log "Memeriksa kesehatan aplikasi..."
    
    # Check auth service
    log "Auth service health:"
    AUTH_SVC_IP=$(kubectl get svc auth-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
    if [[ -n "$AUTH_SVC_IP" ]]; then
        if kubectl run test-auth --image=curlimages/curl --rm -i --restart=Never -- curl -f -s "http://$AUTH_SVC_IP:8080/health" &> /dev/null; then
            log_success "Auth service: HEALTHY"
        else
            log_warning "Auth service: UNHEALTHY"
        fi
    else
        log_warning "Auth service: NOT FOUND"
    fi
    
    # Check meeting service
    log "Meeting service health:"
    MEETING_SVC_IP=$(kubectl get svc meeting-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
    if [[ -n "$MEETING_SVC_IP" ]]; then
        if kubectl run test-meeting --image=curlimages/curl --rm -i --restart=Never -- curl -f -s "http://$MEETING_SVC_IP:8080/health" &> /dev/null; then
            log_success "Meeting service: HEALTHY"
        else
            log_warning "Meeting service: UNHEALTHY"
        fi
    else
        log_warning "Meeting service: NOT FOUND"
    fi
    
    # Check LiveKit SFU
    log "LiveKit SFU health:"
    LIVEKIT_SVC_IP=$(kubectl get svc livekit-sfu -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
    if [[ -n "$LIVEKIT_SVC_IP" ]]; then
        if kubectl run test-livekit --image=curlimages/curl --rm -i --restart=Never -- curl -f -s "http://$LIVEKIT_SVC_IP:7880/health" &> /dev/null; then
            log_success "LiveKit SFU: HEALTHY"
        else
            log_warning "LiveKit SFU: UNHEALTHY"
        fi
    else
        log_warning "LiveKit SFU: NOT FOUND"
    fi
    
    log_success "Application health check completed"
}

# Function to check database connectivity
check_database_connectivity() {
    log "Memeriksa konektivitas database..."
    
    # Check PostgreSQL
    log "PostgreSQL connectivity:"
    kubectl exec -n "$NAMESPACE" deployment/pgbouncer-do -- psql "$DATABASE_URL" -c "SELECT 1;" &> /dev/null && log_success "PostgreSQL: CONNECTED" || log_warning "PostgreSQL: DISCONNECTED"
    
    # Check Redis
    log "Redis connectivity:"
    kubectl exec -n "$NAMESPACE" deployment/redis-commander -- redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" ping &> /dev/null && log_success "Redis: CONNECTED" || log_warning "Redis: DISCONNECTED"
    
    log_success "Database connectivity check completed"
}

# Function to check resource utilization
check_resource_utilization() {
    log "Memeriksa utilisasi resource..."
    
    # Check node resource usage
    log "Node resource usage:"
    kubectl top nodes 2>/dev/null || log_warning "Metrics server tidak tersedia"
    
    # Check pod resource usage
    log "Pod resource usage:"
    kubectl top pods -n "$NAMESPACE" --sort-by=cpu 2>/dev/null || log_warning "Metrics server tidak tersedia"
    
    # Check resource quotas
    log "Resource quotas:"
    kubectl get resourcequota -n "$NAMESPACE" 2>/dev/null || log "Tidak ada resource quota"
    
    # Check limit ranges
    log "Limit ranges:"
    kubectl get limitrange -n "$NAMESPACE" 2>/dev/null || log "Tidak ada limit range"
    
    log_success "Resource utilization check completed"
}

# Function to check scaling status
check_scaling_status() {
    log "Memeriksa status scaling..."
    
    # Check HPA details
    log "HPA details:"
    kubectl describe hpa -n "$NAMESPACE"
    
    # Check current replicas
    log "Current replicas:"
    kubectl get deployment -n "$NAMESPACE" -o custom-columns=NAME:.metadata.name,REPLICAS:.status.readyReplicas,DESIRED:.spec.replicas
    
    log_success "Scaling status check completed"
}

# Function to check network policies
check_network_policies() {
    log "Memeriksa network policies..."
    
    # List network policies
    log "Network policies:"
    kubectl get networkpolicies -n "$NAMESPACE" -o wide
    
    # Check policy enforcement
    log "Network policy details:"
    kubectl describe networkpolicies -n "$NAMESPACE"
    
    log_success "Network policies check completed"
}

# Function to check security
check_security() {
    log "Memeriksa keamanan..."
    
    # Check pod security context
    log "Pod security contexts:"
    kubectl get pods -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.securityContext}{"\n"}{end}'
    
    # Check secrets
    log "Secrets:"
    kubectl get secrets -n "$NAMESPACE"
    
    # Check service accounts
    log "Service accounts:"
    kubectl get serviceaccounts -n "$NAMESPACE"
    
    # Check RBAC
    log "RBAC roles:"
    kubectl get roles,rolebindings -n "$NAMESPACE"
    
    log_success "Security check completed"
}

# Function to get logs
get_logs() {
    local service="$1"
    local lines="${2:-50}"
    
    if [[ -z "$service" ]]; then
        log_error "Service name is required"
        return 1
    fi
    
    log "Mengambil logs untuk $service (last $lines lines)..."
    
    case "$service" in
        "auth")
            kubectl logs -n "$NAMESPACE" deployment/auth-service --tail="$lines" -f
            ;;
        "meeting")
            kubectl logs -n "$NAMESPACE" deployment/meeting-service --tail="$lines" -f
            ;;
        "signaling")
            kubectl logs -n "$NAMESPACE" deployment/signaling-service --tail="$lines" -f
            ;;
        "chat")
            kubectl logs -n "$NAMESPACE" deployment/chat-service --tail="$lines" -f
            ;;
        "turn")
            kubectl logs -n "$NAMESPACE" deployment/turn-service --tail="$lines" -f
            ;;
        "livekit")
            kubectl logs -n "$NAMESPACE" deployment/livekit-sfu --tail="$lines" -f
            ;;
        "traefik")
            kubectl logs -n "$NAMESPACE" deployment/traefik --tail="$lines" -f
            ;;
        "postgres")
            kubectl logs -n "$NAMESPACE" deployment/postgres-exporter --tail="$lines" -f
            ;;
        "redis")
            kubectl logs -n "$NAMESPACE" deployment/redis-exporter --tail="$lines" -f
            ;;
        "prometheus")
            kubectl logs -n "$NAMESPACE" deployment/prometheus --tail="$lines" -f
            ;;
        "grafana")
            kubectl logs -n "$NAMESPACE" deployment/grafana --tail="$lines" -f
            ;;
        *)
            log_error "Unknown service: $service"
            log "Available services: auth, meeting, signaling, chat, turn, livekit, traefik, postgres, redis, prometheus, grafana"
            return 1
            ;;
    esac
}

# Function to access service dashboards
access_dashboard() {
    local service="$1"
    local port="$2"
    
    if [[ -z "$service" || -z "$port" ]]; then
        log_error "Service name and port are required"
        return 1
    fi
    
    log "Mengakses dashboard $service di port $port..."
    log "Tekan Ctrl+C untuk stop"
    
    case "$service" in
        "grafana")
            kubectl port-forward svc/grafana "$port:3000" -n "$NAMESPACE"
            ;;
        "prometheus")
            kubectl port-forward svc/prometheus "$port:9090" -n "$NAMESPACE"
            ;;
        "traefik")
            kubectl port-forward svc/traefik "$port:8080" -n "$NAMESPACE"
            ;;
        "redis-commander")
            kubectl port-forward svc/redis-commander "$port:8081" -n "$NAMESPACE"
            ;;
        *)
            log_error "Unknown dashboard: $service"
            log "Available dashboards: grafana, prometheus, traefik, redis-commander"
            return 1
            ;;
    esac
}

# Function to restart service
restart_service() {
    local service="$1"
    
    if [[ -z "$service" ]]; then
        log_error "Service name is required"
        return 1
    fi
    
    log "Restarting service: $service"
    
    case "$service" in
        "auth")
            kubectl rollout restart deployment/auth-service -n "$NAMESPACE"
            kubectl rollout status deployment/auth-service -n "$NAMESPACE"
            ;;
        "meeting")
            kubectl rollout restart deployment/meeting-service -n "$NAMESPACE"
            kubectl rollout status deployment/meeting-service -n "$NAMESPACE"
            ;;
        "signaling")
            kubectl rollout restart deployment/signaling-service -n "$NAMESPACE"
            kubectl rollout status deployment/signaling-service -n "$NAMESPACE"
            ;;
        "chat")
            kubectl rollout restart deployment/chat-service -n "$NAMESPACE"
            kubectl rollout status deployment/chat-service -n "$NAMESPACE"
            ;;
        "turn")
            kubectl rollout restart deployment/turn-service -n "$NAMESPACE"
            kubectl rollout status deployment/turn-service -n "$NAMESPACE"
            ;;
        "livekit")
            kubectl rollout restart deployment/livekit-sfu -n "$NAMESPACE"
            kubectl rollout status deployment/livekit-sfu -n "$NAMESPACE"
            ;;
        "traefik")
            kubectl rollout restart deployment/traefik -n "$NAMESPACE"
            kubectl rollout status deployment/traefik -n "$NAMESPACE"
            ;;
        *)
            log_error "Unknown service: $service"
            log "Available services: auth, meeting, signaling, chat, turn, livekit, traefik"
            return 1
            ;;
    esac
    
    log_success "Service $service restarted successfully"
}

# Function to scale service
scale_service() {
    local service="$1"
    local replicas="$2"
    
    if [[ -z "$service" || -z "$replicas" ]]; then
        log_error "Service name and replica count are required"
        return 1
    fi
    
    log "Scaling service $service to $replicas replicas..."
    
    case "$service" in
        "auth")
            kubectl scale deployment/auth-service --replicas="$replicas" -n "$NAMESPACE"
            ;;
        "meeting")
            kubectl scale deployment/meeting-service --replicas="$replicas" -n "$NAMESPACE"
            ;;
        "signaling")
            kubectl scale deployment/signaling-service --replicas="$replicas" -n "$NAMESPACE"
            ;;
        "chat")
            kubectl scale deployment/chat-service --replicas="$replicas" -n "$NAMESPACE"
            ;;
        "turn")
            kubectl scale deployment/turn-service --replicas="$replicas" -n "$NAMESPACE"
            ;;
        "livekit")
            kubectl scale deployment/livekit-sfu --replicas="$replicas" -n "$NAMESPACE"
            ;;
        "traefik")
            kubectl scale deployment/traefik --replicas="$replicas" -n "$NAMESPACE"
            ;;
        *)
            log_error "Unknown service: $service"
            log "Available services: auth, meeting, signaling, chat, turn, livekit, traefik"
            return 1
            ;;
    esac
    
    log_success "Service $service scaled to $replicas replicas"
}

# Function to show help
show_help() {
    echo "GoMeet DigitalOcean Monitoring Script"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  health              Check overall cluster health"
    echo "  services            Check services health"
    echo "  application         Check application health"
    echo "  database            Check database connectivity"
    echo "  resources           Check resource utilization"
    echo "  scaling             Check scaling status"
    echo "  network             Check network policies"
    echo "  security            Check security settings"
    echo "  logs SERVICE        Get logs for specific service"
    echo "  dashboard SERVICE   Access service dashboard"
    echo "  restart SERVICE     Restart specific service"
    echo "  scale SERVICE N     Scale service to N replicas"
    echo "  all                 Run all health checks"
    echo ""
    echo "Services for logs/dashboard: auth, meeting, signaling, chat, turn, livekit, traefik, postgres, redis, prometheus, grafana"
    echo "Dashboards: grafana (port 3000), prometheus (port 9090), traefik (port 8080), redis-commander (port 8081)"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NAMESPACE  Override namespace (default: gomeet)"
    echo "  -h, --help                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 health                  # Check cluster health"
    echo "  $0 logs auth               # Get auth service logs"
    echo "  $0 dashboard grafana 3000  # Access Grafana dashboard"
    echo "  $0 restart livekit         # Restart LiveKit service"
    echo "  $0 scale auth 5            # Scale auth service to 5 replicas"
}

# Main execution
main() {
    local command="$1"
    shift
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            *)
                break
                ;;
        esac
    done
    
    # Check prerequisites
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl tidak terinstall"
        exit 1
    fi
    
    # Execute command
    case "$command" in
        "health")
            check_cluster_health
            ;;
        "services")
            check_services_health
            ;;
        "application")
            check_application_health
            ;;
        "database")
            check_database_connectivity
            ;;
        "resources")
            check_resource_utilization
            ;;
        "scaling")
            check_scaling_status
            ;;
        "network")
            check_network_policies
            ;;
        "security")
            check_security
            ;;
        "logs")
            get_logs "$1" "$2"
            ;;
        "dashboard")
            access_dashboard "$1" "$2"
            ;;
        "restart")
            restart_service "$1"
            ;;
        "scale")
            scale_service "$1" "$2"
            ;;
        "all")
            check_cluster_health
            check_services_health
            check_application_health
            check_database_connectivity
            check_resource_utilization
            check_scaling_status
            check_network_policies
            check_security
            ;;
        *)
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"